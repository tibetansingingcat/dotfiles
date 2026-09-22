"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.JspHoverProvider = void 0;
const vscode = __importStar(require("vscode"));
const classpathResourceContentProvider_1 = require("./classpathResourceContentProvider");
const variableTypes_1 = require("./variableTypes");
const webAppPaths_1 = require("./webAppPaths");
const hoverMarkdown_1 = require("./hoverMarkdown");
const javaSymbols_1 = require("./javaSymbols");
const elScan_1 = require("./elScan");
const jspScan_1 = require("./jspScan");
const tagAttributes_1 = require("./tagAttributes");
const tokenResolution_1 = require("./tokenResolution");
// Fixed JSP-spec facts about which attribute on a *standard* JSP action names an EL variable --
// `jsp:useBean`'s `id` declares one, `jsp:setProperty`'s `name` references an already-declared one.
// Unlike `elBindingTags`, these aren't a tag library a workspace configures -- they're baked into
// the JSP spec itself, so this is a fixed table rather than something `elBindingTags` should also
// cover, same reasoning `EL_IMPLICIT_OBJECT_TYPES` (variableTypes.ts) is a fixed table rather than a
// config a workspace would need to declare for every JSP file that uses them.
const STANDARD_ACTION_VARIABLE_ATTRIBUTES = new Map([
    ['jsp:useBean', 'id'],
    ['jsp:setProperty', 'name'],
]);
/**
 * Hovers over every JSP construct this extension already resolves for "go to
 * definition" (see `JspDefinitionProvider`/`jspScan.findTokenAt`) or
 * validates (see `TagAttributeDiagnostics`), showing the same resolved
 * target as a link instead of requiring a jump to see it:
 *
 * - A custom tag's name (e.g. `sm:url` in `<sm:url ...>`, either end) shows
 *   what backs it (a `.tag` file or a Java tag-handler class) and every
 *   attribute it declares, each with its Java type.
 * - A single attribute name at a call site (e.g. `bean` in
 *   `<email:attribution-block bean="...">`) shows just that attribute's
 *   declared Java type and whether it's required.
 * - Any tag usage's own variable-*naming* attribute value -- `jsp:useBean`'s
 *   `id`/`jsp:setProperty`'s `name` (fixed JSP-spec facts), or an
 *   `elBindingTags`-configured tag's `var`/`also[].var` (e.g. `paginator` in
 *   `<sm:set var="paginator" ...>`, or `_status` in `varStatus="_status"`) or
 *   `source` (e.g. `_letterboxdProduction` in
 *   `<sm:forEach name="_letterboxdProduction" ...>`) -- shows that variable's
 *   own resolved Java type, the same thing hovering a later `${name}` use of
 *   it would show, not the generic "this attribute
 *   is a String" fact above (see `hoverForVariableNameAttribute`).
 * - An EL function call (e.g. `lfn:checkCapability(...)`) shows the Java
 *   class/method backing it.
 * - An include path (`<%@include file="...">` / `<jsp:include page="...">`)
 *   shows whether it resolves to a workspace file or a jar-bundled resource.
 * - A bare FQCN reference (`<jsp:useBean class="...">`, a scriptlet, a
 *   `<%@page import="...">`, or a `.tag` file's own `<%@attribute
 *   type="...">`) links to the class, when jdtls can resolve it.
 * - A `<jsp:setProperty property="...">` value, or an `elBindingTags`-
 *   configured tag's own `field="...">` value, links to the setter/getter it
 *   resolves to on its sibling `name`/`source` attribute's known Java type --
 *   see `resolvePropertyNameTargetAt` in `tokenResolution.ts`. When that
 *   sibling variable is real but its type couldn't be resolved (most
 *   commonly Supermodel's implicit `name="object"`, or a rebind via an
 *   attribute this extension doesn't model, e.g. `codeOrId`), this still
 *   shows a hover explaining that -- same "say why, don't just go silent"
 *   reasoning as `ElDiagnostics`'s own Hint tier for an EL chain's untyped
 *   base -- rather than looking identical to hovering plain, unremarkable
 *   text.
 *
 * Anywhere the resolver can't find a declaration/target to show (an
 * unresolvable tag, a `<tag-file>`-backed tag, an unindexed taglib, a name
 * the tag doesn't declare, a class jdtls hasn't indexed) gets no hover
 * rather than a hover with nothing useful in it.
 *
 * Every resolution step below re-checks `cancellation` at least once it's
 * awaited (some -- `hoverForElFunctionCall`/`hoverForElPropertyChain` --
 * delegate a short *sequence* of awaits to a function shared with
 * `JspDefinitionProvider` in `tokenResolution.ts`, checked once as a whole
 * rather than between each of that sequence's own internal steps) and bails
 * out to `undefined` as soon as it's requested. Several of these paths make
 * one or more `vscode.executeWorkspaceSymbolProvider` round trips to jdtls
 * (`resolveClass`/`resolveMember`), which is slow enough on a cold cache
 * that the mouse has often moved off the word well before it answers;
 * without this, VSCode was showing/refreshing a hover for a position the
 * cursor had already left, since the eventually-resolved `Hover` had nothing
 * telling it that its request was stale.
 */
class JspHoverProvider {
    tldIndex;
    resolver;
    variableTypes;
    constructor(tldIndex, resolver, variableTypes) {
        this.tldIndex = tldIndex;
        this.resolver = resolver;
        this.variableTypes = variableTypes;
    }
    async provideHover(document, position, cancellation) {
        const text = (0, jspScan_1.maskJspComments)(document.getText());
        const offset = document.offsetAt(position);
        for (const usage of (0, jspScan_1.findCustomTagUsages)(text)) {
            if ((0, hoverMarkdown_1.offsetWithin)(offset, usage.nameRange)) {
                return this.hoverForTag(document, text, usage.prefix, usage.tagName, usage.nameRange, cancellation);
            }
            const variableNameHover = await this.hoverForVariableNameAttribute(document, text, usage, offset, cancellation);
            if (variableNameHover || cancellation.isCancellationRequested) {
                return variableNameHover;
            }
            const attribute = usage.attributes.find((candidate) => (0, hoverMarkdown_1.offsetWithin)(offset, candidate.range));
            if (attribute) {
                return this.hoverForAttribute(document, text, usage, attribute, cancellation);
            }
        }
        const propertyTarget = await (0, tokenResolution_1.resolvePropertyNameTargetAt)(this.variableTypes, document, text, offset);
        if (cancellation.isCancellationRequested) {
            return undefined;
        }
        if (propertyTarget?.kind === 'resolved') {
            const markdown = (0, hoverMarkdown_1.trustedMarkdown)();
            markdown.appendMarkdown((0, hoverMarkdown_1.codeLink)(propertyTarget.propertyName, propertyTarget.location));
            return new vscode.Hover(markdown, (0, hoverMarkdown_1.rangeOf)(document, propertyTarget.range));
        }
        if (propertyTarget?.kind === 'untypedSource') {
            const markdown = (0, hoverMarkdown_1.trustedMarkdown)();
            markdown.appendMarkdown(`Type of \`${propertyTarget.sourceVarName}\` couldn't be resolved, so \`${propertyTarget.propertyName}\` isn't validated.`);
            return new vscode.Hover(markdown, (0, hoverMarkdown_1.rangeOf)(document, propertyTarget.range));
        }
        const token = (0, elScan_1.findTokenAt)(text, offset);
        if (!token) {
            return undefined;
        }
        switch (token.kind) {
            case 'customTag':
                // Only reachable for a closing tag (`</prefix:name>`) -- an opening
                // tag's name is already handled by findCustomTagUsages above.
                return this.hoverForTag(document, text, token.prefix, token.tagName, token.range, cancellation);
            case 'elFunctionCall':
                return this.hoverForElFunctionCall(document, text, token, cancellation);
            case 'includePath':
                return this.hoverForIncludePath(document, token, cancellation);
            case 'useBeanClass':
            case 'scriptletFqcn':
            case 'pageImportFqcn':
            case 'attributeType':
                return this.hoverForFqcn(document, token, cancellation);
            case 'elPropertyChain':
                return this.hoverForElPropertyChain(document, text, token, cancellation);
            default:
                return undefined;
        }
    }
    async hoverForTag(document, text, prefix, tagName, nameRange, cancellation) {
        const { info, resolveBacking } = await this.resolver.resolve(document, text, prefix, tagName);
        if (cancellation.isCancellationRequested) {
            return undefined;
        }
        const { label: backingLabel, location: backingLocation } = await resolveBacking();
        if (cancellation.isCancellationRequested) {
            return undefined;
        }
        if (!info && !backingLabel) {
            return undefined;
        }
        const markdown = (0, hoverMarkdown_1.trustedMarkdown)();
        markdown.appendMarkdown(`**&lt;${prefix}:${tagName}&gt;**`);
        if (backingLabel) {
            markdown.appendMarkdown(`\n\nBacked by ${(0, hoverMarkdown_1.codeLink)(backingLabel, backingLocation)}`);
        }
        if (info?.hasDynamicAttributes) {
            markdown.appendMarkdown('\n\nAccepts arbitrary attributes (`dynamic-attributes`).');
        }
        else if (info && info.declaredNames.size === 0) {
            markdown.appendMarkdown('\n\nNo declared attributes.');
        }
        else if (info) {
            const lines = await Promise.all(Array.from(info.declaredNames, (name) => this.describeAttribute(name, info)));
            if (cancellation.isCancellationRequested) {
                return undefined;
            }
            markdown.appendMarkdown(`\n\n${lines.map((line) => `- ${line}`).join('\n')}`);
        }
        return new vscode.Hover(markdown, (0, hoverMarkdown_1.rangeOf)(document, nameRange));
    }
    async hoverForAttribute(document, text, usage, attribute, cancellation) {
        const { info } = await this.resolver.resolve(document, text, usage.prefix, usage.tagName);
        if (cancellation.isCancellationRequested) {
            return undefined;
        }
        if (!info?.declaredNames.has(attribute.name) || info.hasDynamicAttributes) {
            return undefined;
        }
        const line = await this.describeAttribute(attribute.name, info);
        if (cancellation.isCancellationRequested) {
            return undefined;
        }
        const markdown = (0, hoverMarkdown_1.trustedMarkdown)();
        markdown.appendMarkdown(line);
        return new vscode.Hover(markdown, (0, hoverMarkdown_1.rangeOf)(document, attribute.range));
    }
    /**
     * When `offset` is on the *value* of an attribute that names an EL variable on this tag usage --
     * from two sources, merged into one `variableAttributeNames` set: `STANDARD_ACTION_VARIABLE_ATTRIBUTES`,
     * a fixed table for the JSP-spec actions `jsp:useBean`'s `id` and `jsp:setProperty`'s `name`; and,
     * for any other tag, its `elBindingTags` config's `var`/`also[].var` (declares one, e.g.
     * `var="paginator"` or `varStatus="_status"` via `also`) or `source` (references an
     * already-declared one, e.g. `name="_letterboxdProduction"` where this config's `source` is
     * `"name"`) -- shows that variable's resolved Java type, the same thing hovering a later `${name}`
     * use of it would show. Every one of these collapses to the exact same lookup, not a separate
     * resolution path per source: an attribute whose value *is* a variable name is a reference to that
     * variable in exactly the same sense `${name}` is, whether this usage is what declared it, a
     * workspace-configured tag references it, or it's a built-in JSP action -- so this reuses
     * `resolveElPropertyChainTarget`/`resolveChainSegment`, the same shared resolver every other
     * EL-chain hover in this extension already goes through (see `hoverForElPropertyChain`), fed a
     * synthetic one-segment chain rather than a bespoke "look up a variable's type and link it" path.
     *
     * Checked as its own early step in `provideHover`, not folded into `hoverForAttribute`, because
     * `CustomTagAttributeUsage.range` only spans the attribute *name* (see `scanTagAttributes` in
     * jspScan.ts) -- `hoverForAttribute` is only ever reached for a name-range hover, never a
     * value-range one, so a variable-name *value* hover needs its own offset check here, same
     * reasoning `field="..."`/`<jsp:setProperty property="...">` value hovers already have their own
     * separate check (`resolvePropertyNameTargetAt`) rather than living inside `hoverForAttribute` too.
     */
    async hoverForVariableNameAttribute(document, text, usage, offset, cancellation) {
        const tag = `${usage.prefix}:${usage.tagName}`;
        const config = (0, variableTypes_1.getBindingTagConfigs)().find((candidate) => candidate.tag === tag);
        const variableAttributeNames = new Set([STANDARD_ACTION_VARIABLE_ATTRIBUTES.get(tag), config?.var, config?.source, ...(config?.also ?? []).map((also) => also.var)].filter((name) => !!name));
        if (variableAttributeNames.size === 0) {
            return undefined;
        }
        const attribute = usage.attributes.find((candidate) => variableAttributeNames.has(candidate.name) && candidate.valueRange && (0, hoverMarkdown_1.offsetWithin)(offset, candidate.valueRange));
        if (!attribute?.value || !attribute.valueRange) {
            return undefined;
        }
        const segments = [{ name: attribute.value, range: attribute.valueRange }];
        const segment = await (0, tokenResolution_1.resolveElPropertyChainTarget)(this.variableTypes, document, text, segments);
        if (cancellation.isCancellationRequested || !segment) {
            return undefined;
        }
        const markdown = (0, hoverMarkdown_1.trustedMarkdown)();
        markdown.appendMarkdown((0, hoverMarkdown_1.codeLink)(segment.type, segment.location));
        return new vscode.Hover(markdown, (0, hoverMarkdown_1.rangeOf)(document, attribute.valueRange));
    }
    /**
     * Renders one attribute's declared Java type (linked to its class
     * declaration when jdtls can resolve it) and whether it's required, as a
     * single line of markdown.
     */
    async describeAttribute(name, info) {
        const type = (0, tagAttributes_1.declaredAttributeType)(info, name);
        const required = info.requiredNames.has(name);
        const classLocation = await (0, javaSymbols_1.resolveClass)(type);
        return `**${name}**: ${(0, hoverMarkdown_1.codeLink)(type, classLocation)}${required ? ' *(required)*' : ''}`;
    }
    async hoverForElFunctionCall(document, text, token, cancellation) {
        const fn = await (0, tokenResolution_1.resolveElFunctionTarget)(this.tldIndex, text, document.uri, token.prefix, token.functionName);
        if (cancellation.isCancellationRequested) {
            return undefined;
        }
        if (fn) {
            const markdown = (0, hoverMarkdown_1.trustedMarkdown)();
            markdown.appendMarkdown((0, hoverMarkdown_1.codeLink)(`${fn.className}#${fn.methodName}`, fn.location));
            return new vscode.Hover(markdown, (0, hoverMarkdown_1.rangeOf)(document, token.range));
        }
        // Not a real taglib function -- possibly one this workspace has declared as resolved outside
        // the taglib mechanism entirely (see `TldIndex.describeCompilerRecognizedFunction`), in which
        // case there's still something useful to show even though there's no Java definition to link to.
        const description = this.tldIndex.describeCompilerRecognizedFunction(token.prefix, token.functionName);
        if (!description) {
            return undefined;
        }
        const markdown = (0, hoverMarkdown_1.trustedMarkdown)();
        markdown.appendMarkdown(description);
        return new vscode.Hover(markdown, (0, hoverMarkdown_1.rangeOf)(document, token.range));
    }
    async hoverForElPropertyChain(document, text, token, cancellation) {
        const segment = await (0, tokenResolution_1.resolveElPropertyChainTarget)(this.variableTypes, document, text, token.segments);
        if (cancellation.isCancellationRequested) {
            return undefined;
        }
        if (!segment) {
            return undefined;
        }
        const markdown = (0, hoverMarkdown_1.trustedMarkdown)();
        markdown.appendMarkdown((0, hoverMarkdown_1.codeLink)(segment.type, segment.location));
        return new vscode.Hover(markdown, (0, hoverMarkdown_1.rangeOf)(document, token.range));
    }
    async hoverForIncludePath(document, token, cancellation) {
        const location = await (0, webAppPaths_1.resolveIncludePath)(document.uri, token.path);
        if (cancellation.isCancellationRequested) {
            return undefined;
        }
        if (!location) {
            return undefined;
        }
        const origin = location.uri.scheme === classpathResourceContentProvider_1.CLASSPATH_RESOURCE_SCHEME ? 'bundled in a jar' : 'workspace file';
        const markdown = (0, hoverMarkdown_1.trustedMarkdown)();
        markdown.appendMarkdown(`${(0, hoverMarkdown_1.codeLink)(token.path, location)} — ${origin}`);
        return new vscode.Hover(markdown, (0, hoverMarkdown_1.rangeOf)(document, token.range));
    }
    async hoverForFqcn(document, token, cancellation) {
        const location = await (0, javaSymbols_1.resolveClass)(token.fqcn);
        if (cancellation.isCancellationRequested) {
            return undefined;
        }
        if (!location) {
            return undefined;
        }
        const markdown = (0, hoverMarkdown_1.trustedMarkdown)();
        markdown.appendMarkdown((0, hoverMarkdown_1.codeLink)(token.fqcn, location));
        return new vscode.Hover(markdown, (0, hoverMarkdown_1.rangeOf)(document, token.range));
    }
}
exports.JspHoverProvider = JspHoverProvider;
//# sourceMappingURL=jspHoverProvider.js.map