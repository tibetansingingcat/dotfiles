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
exports.JspDefinitionProvider = void 0;
const vscode = __importStar(require("vscode"));
const webAppPaths_1 = require("./webAppPaths");
const elScan_1 = require("./elScan");
const jspScan_1 = require("./jspScan");
const javaSymbols_1 = require("./javaSymbols");
const tokenResolution_1 = require("./tokenResolution");
class JspDefinitionProvider {
    tldIndex;
    variableTypes;
    tagAttributesResolver;
    constructor(tldIndex, variableTypes, tagAttributesResolver) {
        this.tldIndex = tldIndex;
        this.variableTypes = variableTypes;
        this.tagAttributesResolver = tagAttributesResolver;
    }
    async provideDefinition(document, position) {
        const text = (0, jspScan_1.maskJspComments)(document.getText());
        const offset = document.offsetAt(position);
        // Not part of JspToken/findTokenAt -- see resolvePropertyNameTargetAt's
        // own comment for why -- so checked directly, same as JspHoverProvider.
        // Its 'untypedSource' result has no location to jump to (unlike hover,
        // there's no "explain why not" state for "go to definition") -- falling
        // through to findTokenAt below is harmless, since it won't recognize
        // this offset as anything either, and correctly yields no definition.
        const propertyTarget = await (0, tokenResolution_1.resolvePropertyNameTargetAt)(this.variableTypes, document, text, offset);
        if (propertyTarget?.kind === 'resolved') {
            return [this.locationLink(document, propertyTarget.range, propertyTarget.location)];
        }
        const token = (0, elScan_1.findTokenAt)(text, offset);
        if (!token) {
            return undefined;
        }
        const location = await this.resolveToken(document, text, token);
        if (!location) {
            return undefined;
        }
        return [this.locationLink(document, token.range, location)];
    }
    // A plain vscode.Location leaves VSCode to compute the hover-underline
    // range itself via default word-boundary splitting (on ".", "/", "-"),
    // which chops multi-segment tokens like FQNs and include paths into
    // fragments. Returning a LocationLink with an explicit originSelectionRange
    // makes the *entire* source range highlight/link as one.
    locationLink(document, range, location) {
        return {
            originSelectionRange: new vscode.Range(document.positionAt(range[0]), document.positionAt(range[1])),
            targetUri: location.uri,
            targetRange: location.range,
        };
    }
    async resolveToken(document, text, token) {
        switch (token.kind) {
            case 'useBeanClass':
            case 'scriptletFqcn':
            case 'pageImportFqcn':
            case 'attributeType':
                return (0, javaSymbols_1.resolveClass)(token.fqcn);
            case 'elFunctionCall': {
                const fn = await (0, tokenResolution_1.resolveElFunctionTarget)(this.tldIndex, text, document.uri, token.prefix, token.functionName);
                return fn?.location;
            }
            case 'includePath':
                return (0, webAppPaths_1.resolveIncludePath)(document.uri, token.path);
            case 'customTag': {
                // Same resolution `JspHoverProvider` shows on hover -- via the
                // shared `TagAttributesResolver`, not an independent tagFile/tagClass
                // lookup of this provider's own (which is what this used to be, and
                // is exactly the kind of duplicate-implementation drift risk this
                // extension has repeatedly had to unwind elsewhere).
                const { resolveBacking } = await this.tagAttributesResolver.resolve(document, text, token.prefix, token.tagName);
                const { location } = await resolveBacking();
                return location;
            }
            case 'elPropertyChain': {
                const segment = await (0, tokenResolution_1.resolveElPropertyChainTarget)(this.variableTypes, document, text, token.segments);
                return segment?.location;
            }
            default:
                return undefined;
        }
    }
}
exports.JspDefinitionProvider = JspDefinitionProvider;
//# sourceMappingURL=definitionProvider.js.map