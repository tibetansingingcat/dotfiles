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
exports.PRIMITIVE_WRAPPERS = exports.NUMERIC_TYPES = void 0;
exports.resolveClass = resolveClass;
exports.resolveMember = resolveMember;
exports.getterCandidateNames = getterCandidateNames;
exports.setterCandidateNames = setterCandidateNames;
exports.clearJavaSymbolCaches = clearJavaSymbolCaches;
exports.resolveMemberReturnType = resolveMemberReturnType;
exports.resolveChainHop = resolveChainHop;
exports.resolveChainType = resolveChainType;
exports.resolveChainSegment = resolveChainSegment;
exports.resolveElFunctionCallType = resolveElFunctionCallType;
exports.inferArgumentType = inferArgumentType;
exports.checkArgumentCompatibility = checkArgumentCompatibility;
exports.isAssignableTo = isAssignableTo;
exports.missingMemberDiagnostic = missingMemberDiagnostic;
exports.unknownMemberDiagnostic = unknownMemberDiagnostic;
exports.resolveGetterReturnType = resolveGetterReturnType;
exports.resolveIterationElementType = resolveIterationElementType;
exports.unwrapMapValueType = unwrapMapValueType;
exports.resolveMethodOverloads = resolveMethodOverloads;
exports.resolveClasses = resolveClasses;
const vscode = __importStar(require("vscode"));
const diagnostics_1 = require("./diagnostics");
const javaExtensionGateway_1 = require("./javaExtensionGateway");
const elParser_1 = require("./el/elParser");
const jspScan_1 = require("./jspScan");
const javaHeritageClause_1 = require("./javaHeritageClause");
const jdtUri_1 = require("./jdtUri");
const tldParsing_1 = require("./tldParsing");
const PACKAGE_DECLARATION = /^\s*package\s+([\w.]+)\s*;/m;
const TYPE_KINDS = new Set([
    vscode.SymbolKind.Class,
    vscode.SymbolKind.Interface,
    vscode.SymbolKind.Enum,
    vscode.SymbolKind.Struct,
]);
// Package segments are conventionally lowercase and type segments start with
// an uppercase letter, so we can split an FQCN into package vs. type-nesting
// without needing to actually resolve it first. Shared by `splitFqcn` below (walking a whole
// already-dotted FQCN backwards to find where its package prefix ends) and
// `qualifyBareIdentifiersIn`'s own match filter (deciding whether a *single* dotted token read off
// raw source text, e.g. `"ReportsPaginator.Report"`, is already package-qualified or is instead an
// unqualified `Outer.Inner` self-reference still needing its outer segment resolved) -- the same
// convention, not two independent guesses at it.
function looksLikeTypeSegment(segment) {
    return /^[A-Z]/.test(segment);
}
/**
 * A resolved type string can carry generics/array brackets intact (see `GetterReturnType.type`'s own
 * doc -- e.g. `"List<Film>"`, `"AbstractProduction<?>"`) -- useful for display, but a class *lookup*
 * only ever wants the bare class name: jdtls's workspace/document symbol indexes never include a
 * generic or array suffix in a class's own name, so passing one through unstripped means the lookup
 * key never matches anything real. That's silently indistinguishable from "this class doesn't exist"
 * to every caller (`resolveClass` returning `undefined`, or `resolveMemberReturnTypeUncached`'s own
 * `simpleName` split missing the type's document symbol) -- there's no way to tell "not found" apart
 * from "not found because of a generic suffix one hop upstream" without this stripped first.
 */
function stripGenericsAndArrays(fqcn) {
    return fqcn.replace(/<[\s\S]*>/, '').replace(/\[\]/g, '').trim();
}
function splitFqcn(rawFqcn) {
    const segments = stripGenericsAndArrays(rawFqcn).split('.');
    const simpleName = segments[segments.length - 1];
    let splitIndex = segments.length - 1;
    while (splitIndex > 0 && looksLikeTypeSegment(segments[splitIndex - 1])) {
        splitIndex--;
    }
    const expectedPackage = segments.slice(0, splitIndex).join('.');
    const outerSimpleName = splitIndex < segments.length - 1 ? segments[splitIndex] : undefined;
    return { simpleName, expectedPackage, outerSimpleName };
}
/**
 * Whether `uri` is `expectedPackage`/`outerSimpleName`'s own declaration -- the one place in this
 * file that confirms a URI actually belongs to a given (package, outer-type) pair, shared by every
 * caller that needs to tell one candidate class apart from another same-simple-name one, regardless
 * of what kind of lookup produced the candidate URI in the first place: `resolveClass`'s own
 * `executeWorkspaceSymbolProvider` search (a `SymbolInformation.location.uri`), or a hierarchy-walk
 * hop's raw `JavaTypeHierarchyItem.uri` (`hierarchyItemIsFqcn` below). Those are two independent
 * jdtls code paths, and NOT interchangeable identifiers for "the same class" -- comparing one's own
 * URI string against a `vscode.Location` resolved the *other* way (as both `hierarchyItemIsFqcn`'s own
 * callers used to, each separately) never actually matches for a `jdt://` target: confirmed live for
 * `java.util.List` specifically, where none of 844 same-simple-name `executeWorkspaceSymbolProvider`
 * candidates matched a go-to-definition `Location` for that exact class by URI string (see
 * `qualifyReturnType`'s own doc, and `jdtUri.ts`'s `packageFromJdtPath`, which exists for the same
 * reason). This function is what lets every caller sidestep that by never comparing two URIs against
 * each other at all -- each is independently checked against the (package, outer-type) pair the
 * caller already knows statically from the FQCN string itself.
 *
 * For a `jdt://` target, the package is read straight off the URI's own path (`packageFromJdtPath`,
 * no document open needed) -- sufficient on its own whenever there's no outer type to confirm (the
 * common case: `outerSimpleName` is only set for a dotted, nested-class FQCN like `Map.Entry`, and a
 * jdt path segment doesn't distinguish a nested class's own file from its enclosing one). Anything
 * else -- a `file://` target, or a `jdt://` one that still needs its outer type confirmed -- falls
 * back to opening the document and reading its own `package` declaration (plus, when `outerSimpleName`
 * is given, checking that type's own declaration appears in the same file) directly off the source
 * text, the only way to get either fact for a real project `.java` file.
 */
async function locationMatchesFqcn(uri, expectedPackage, outerSimpleName) {
    const jdtPackage = (0, jdtUri_1.packageFromJdtPath)(uri.scheme, uri.path);
    if (jdtPackage !== undefined && outerSimpleName === undefined) {
        return jdtPackage === expectedPackage;
    }
    try {
        const doc = await vscode.workspace.openTextDocument(uri);
        const text = doc.getText();
        const match = PACKAGE_DECLARATION.exec(text);
        const actualPackage = match ? match[1] : '';
        if (actualPackage !== expectedPackage) {
            return false;
        }
        if (outerSimpleName) {
            const outerTypePattern = new RegExp(`\\b(class|interface|enum|record)\\s+${outerSimpleName}\\b`);
            if (!outerTypePattern.test(text)) {
                return false;
            }
        }
        return true;
    }
    catch {
        return false;
    }
}
/**
 * `locationMatchesFqcn`, for a hierarchy-walk hop (a raw `JavaTypeHierarchyItem`, from jdtls's own
 * `resolveTypeHierarchy` custom command -- see `walkSupertypes`) instead of a `resolveClass` candidate
 * -- shared by `resolveIterationElementTypeViaHierarchy` (checking for `java.lang.Iterable`/
 * `java.util.Map` specifically) and `isAssignableToUncached` (checking for an arbitrary `superFqcn`).
 * `item.name` is jdtls's own bare simple name (confirmed never anything else -- see
 * `resolveHopSubstitution`'s own doc), so this only needs `locationMatchesFqcn`'s (package, outer-type)
 * check to confirm the rest.
 */
async function hierarchyItemIsFqcn(item, fqcn) {
    const { simpleName, expectedPackage, outerSimpleName } = splitFqcn(fqcn);
    return item.name === simpleName && (await locationMatchesFqcn(vscode.Uri.parse(item.uri), expectedPackage, outerSimpleName));
}
/**
 * Session-long cache of `resolveClassUncached`'s result per FQCN -- same reasoning
 * `memberReturnTypeCache` below documents for member lookups: whether a class exists, and where,
 * doesn't change without the underlying `.java` source itself changing, so re-issuing a fresh
 * `vscode.executeWorkspaceSymbolProvider` call for the same FQCN every time it's referenced is pure
 * waste. That waste is routine, not theoretical: a common FQCN (a project domain class,
 * `java.lang.String`, a tag handler class) is typically referenced by many JSPs, and
 * checkAllCommand.ts's "Check All Files" run resolves every one of them across the whole workspace in
 * one pass. Cleared alongside the other caches in `clearJavaSymbolCaches`, same `.java`-file-change
 * trigger.
 */
const classLocationCache = new Map();
/**
 * Resolves a fully-qualified Java class name to its declaration by delegating
 * to whatever Java tooling is installed (redhat.java / jdtls), rather than
 * parsing Java ourselves.
 *
 * Checked here, centrally, rather than left to each caller: `resolveClass` is
 * the base every other lookup in this file builds on (`resolveMemberReturnType`
 * calls it first, before doing anything else), but before this check was added
 * only `linkDiagnostics.ts`/`tldDiagnostics.ts` remembered to gate on
 * `isJavaServerReady()` themselves -- hover, "go to definition", and EL chain
 * type resolution (`definitionProvider.ts`, `jspHoverProvider.ts`,
 * `variableTypes.ts`, `tagAttributesResolver.ts`) all called this
 * unconditionally. On a large multi-module Maven project, `executeWorkspaceSymbolProvider`
 * can return an incomplete result set for a real, existing class while the
 * workspace's full project import/classpath resolution is still catching up
 * behind `serverReady()`'s initial signal -- indistinguishable, from here,
 * from the class genuinely not existing. Returning `undefined` early (every
 * caller already treats that as "couldn't resolve, do nothing") is the same
 * "abstain rather than guess wrong" rule `resolveMemberReturnTypeUncached`
 * already applies for its own `'unknown'` results -- and, for the same reason,
 * never touches `classLocationCache`: caching a "not ready yet" answer would
 * mean it never gets retried even after `trackJavaServerReadiness` fires
 * `validateAllOpen()` once jdtls actually does become ready.
 */
async function resolveClass(rawFqcn) {
    if (!javaExtensionGateway_1.javaExtensionGateway.isReady()) {
        return undefined;
    }
    // A bare `java.lang` simple name (e.g. `"String"`, straight off a raw generic-signature type
    // argument like `List<String>`) has no package for `splitFqcn`/`locationMatchesFqcn` to match
    // against below -- normalizing here, the one place every caller's class lookup already funnels
    // through, means every caller gets this for free instead of each needing its own call to
    // `normalizeJavaLangType` (previously only `checkArgumentCompatibility` did).
    const fqcn = normalizeJavaLangType(rawFqcn);
    const cached = classLocationCache.get(fqcn);
    if (cached) {
        return cached;
    }
    const result = resolveClassUncached(fqcn).then(({ location, cacheable }) => {
        // A jdtls call failure (`javaExtensionGateway.execute`'s own undefined-on-error contract) is
        // transient, not a stable fact about whether `fqcn` exists -- same "don't cache what we
        // couldn't actually confirm" rule `resolveMemberReturnType` applies to its own `'unknown'`
        // status. A confidently empty/resolved response is real information and stays cached.
        if (!cacheable) {
            classLocationCache.delete(fqcn);
        }
        return location;
    });
    classLocationCache.set(fqcn, result);
    return result;
}
/**
 * `resolveClass`'s actual jdtls lookup, run at most once per FQCN per session (see
 * `classLocationCache` above). `cacheable` is `false` only when the underlying
 * `executeWorkspaceSymbolProvider` call itself failed (`javaExtensionGateway.execute` returning
 * `undefined` on error) -- everything else, including a confidently empty result set, is real
 * information safe to cache.
 */
async function resolveClassUncached(fqcn) {
    const { simpleName, expectedPackage, outerSimpleName } = splitFqcn(fqcn);
    const symbols = await javaExtensionGateway_1.javaExtensionGateway.execute('vscode.executeWorkspaceSymbolProvider', simpleName);
    if (!symbols) {
        return { location: undefined, cacheable: false };
    }
    if (symbols.length === 0) {
        return { location: undefined, cacheable: true };
    }
    const candidates = symbols.filter((s) => s.name === simpleName && TYPE_KINDS.has(s.kind));
    for (const candidate of candidates) {
        if (await locationMatchesFqcn(candidate.location.uri, expectedPackage, outerSimpleName)) {
            return { location: candidate.location, cacheable: true };
        }
    }
    // No candidate passed the package/outer-type check. Only fall back when
    // there's exactly ONE same-simple-name candidate on the whole classpath --
    // that's a real signal it's probably the right class under an unusual
    // naming convention `locationMatchesFqcn` didn't anticipate (e.g. its
    // regex-based package-declaration extraction missing an edge case).
    // Falling back with *multiple* candidates has no such signal: `fqcn` not
    // existing at all is far more common in practice than an unusual
    // convention (a typo'd/renamed/copy-pasted class name, most commonly), and
    // taking `candidates[0]` there means silently landing on whichever
    // same-named class jdtls's workspace symbol search happens to return
    // first among however many exist across every dependency on the
    // classpath -- e.g. `com.letterboxd.om.List` (never declared anywhere in
    // this project) resolving to an unrelated nested `List` request class deep
    // inside a Google API client library, purely by index-order coincidence.
    // Every caller of this function treats `undefined` as "couldn't resolve"
    // and degrades gracefully (see e.g. `resolveClasses` below, which backs
    // the "does this class exist" diagnostics) -- silently landing on the
    // wrong class is worse than that, not better, since it looks resolved.
    return { location: candidates.length === 1 ? candidates[0].location : undefined, cacheable: true };
}
/**
 * Resolves a member (currently: a method) declared on the given FQCN, for
 * hover/"go to definition" (an EL function call's backing method, or a
 * Java-class-backed tag's method) -- as opposed to a diagnostic, this always
 * falls back to the class's own location when the member itself can't be
 * pinned down (`missing` *or* `unknown`), since landing on the right class is
 * still a useful destination and a diagnostic's stricter "don't guess wrong"
 * distinction between those two doesn't apply to a link a user can just look
 * at and dismiss.
 *
 * Delegates to `resolveMemberReturnType` -- the one member-resolution
 * primitive this whole file funnels through -- rather than its own direct-
 * `docSymbols`-only scan (which this used to be, before a getter/setter/
 * literal-name lookup were unified into the same function): that second copy
 * meant this one silently never got the supertype walk
 * (`resolveInheritedMember`) the others have, so "go to definition" on an EL
 * function/tag method inherited from a superclass would land on the class
 * itself instead of the real (inherited) method -- lower-stakes than the
 * equivalent gap once was for a setter, since nothing diagnostic-facing
 * calls this function, but the same underlying mistake: a second hand-rolled
 * copy of "does this member exist on this class" that quietly fell out of
 * sync with the one everything else uses.
 */
async function resolveMember(fqcn, memberName) {
    const classLocation = await resolveClass(fqcn);
    if (!classLocation) {
        return undefined;
    }
    const lookup = await resolveMemberReturnType(fqcn, [memberName]);
    return lookup.status === 'found' ? lookup.location : classLocation;
}
function capitalize(s) {
    return s.charAt(0).toUpperCase() + s.slice(1);
}
/**
 * Candidate method names for a JavaBean getter on `propertyName` (e.g. `"person"` ->
 * `["getPerson", "isPerson"]`), to pass to `resolveMemberReturnType`. A getter and a setter
 * lookup aren't different operations -- both are "resolve one of these candidate names on this
 * class, walking supertypes if needed" -- they differ only in which naming convention computes
 * the candidate list, which is what this and `setterCandidateNames` below capture: two one-line,
 * non-jdtls-touching helpers, not two separately-named resolver functions each wrapping their own
 * copy of the same call.
 */
function getterCandidateNames(propertyName) {
    const cap = capitalize(propertyName);
    return [`get${cap}`, `is${cap}`];
}
/** Candidate method name for a JavaBean setter on `propertyName` (e.g. `"person"` -> `["setPerson"]`) -- see `getterCandidateNames`. */
function setterCandidateNames(propertyName) {
    return [`set${capitalize(propertyName)}`];
}
/**
 * Extracts a member's return type from the text preceding its name in
 * source -- e.g. "List<Film> " before "getFavouriteFilmsValidated". Usually
 * that's the span between the DocumentSymbol's `range` (start of the whole
 * declaration, modifiers included) and `selectionRange` (start of just the
 * name). A Lombok-generated accessor has no such span to read: jdtls reports
 * its `range`/`selectionRange` collapsed to the exact same zero-width
 * position, pointing at the *field* it was generated from rather than at any
 * real method declaration text at all (confirmed by inspection: for
 * `AnythingList`'s Lombok class-level `@Getter`-generated `getPerson()`,
 * both `range` and `selectionRange` were `[120:16, 120:22]` -- precisely the
 * span of "person" in `private Person person;`, with nothing distinguishing
 * "the method" from "the field" at all). Falls back to that field's own
 * declaration *line*, read up to that same position -- "private Person "
 * before "person" -- which for a JavaBean-style Lombok `@Getter`/`@Setter`
 * is exactly the accessor's return/parameter type by construction (Lombok
 * generates `public FieldType getFieldName()` from `private FieldType
 * fieldName;`).
 */
function extractMemberReturnType(document, member) {
    const signaturePrefix = document.getText(new vscode.Range(member.range.start, member.selectionRange.start));
    const direct = RETURN_TYPE_BEFORE_NAME.exec(signaturePrefix);
    if (direct) {
        const rangeStartOffset = document.offsetAt(member.range.start);
        const methodTypeParams = (0, javaHeritageClause_1.extractMethodTypeParameters)(signaturePrefix.slice(0, direct.index)).map((param) => ({
            ...param,
            boundOffset: param.boundOffset === undefined ? undefined : rangeStartOffset + param.boundOffset,
        }));
        return { text: direct[1], position: document.positionAt(rangeStartOffset + direct.index), methodTypeParams };
    }
    if (!member.range.isEqual(member.selectionRange)) {
        return undefined;
    }
    const line = member.selectionRange.start.line;
    const linePrefix = document.lineAt(line).text.slice(0, member.selectionRange.start.character);
    const fallback = RETURN_TYPE_BEFORE_NAME.exec(linePrefix);
    // A Lombok-generated accessor's own fallback (a field declaration line, e.g. "private Person ")
    // is never a generic method of its own -- `methodTypeParams` is always `[]` here.
    return fallback ? { text: fallback[1], position: new vscode.Position(line, fallback.index), methodTypeParams: [] } : undefined;
}
/**
 * Whether `member` -- a `findMember(..., 'field')` match -- is actually reachable the way real EL
 * would reach it: `jakarta.el.BeanELResolver`'s own field fallback, and `StaticFieldELResolver`
 * (imported-class static field access), both read a field via plain reflection with no
 * `setAccessible` call, so a `private`/`protected` field can never actually resolve at runtime even
 * though jdtls still reports its `DocumentSymbol` like any other member. Checked only for the
 * field-kind fallback in `findMemberOrRecordComponent` -- a *method* match has no equivalent concern:
 * an accessor a JSP could ever actually call is public by construction, and this file has never
 * filtered a getter/setter search on visibility, so this isn't extending that to cover a case that
 * already worked. Reads the exact same modifiers-before-name span `extractMemberReturnType` reads
 * (not a second text extraction) -- just checked for `private`/`protected` rather than parsed as a
 * type.
 */
function isPublicField(document, member) {
    const signaturePrefix = document.getText(new vscode.Range(member.range.start, member.selectionRange.start));
    return !/\b(private|protected)\b/.test(signaturePrefix);
}
// Matches one bare-or-dotted type-name token, greedily including every `.segment` so an
// already-qualified reference (`"com.letterboxd.om.Person"`) comes back as one match rather than four.
// A dotted match isn't automatically "already qualified, leave alone" though -- see
// `qualifyBareIdentifiersIn`'s own doc on why an uppercase-starting leading segment (e.g.
// `"ReportsPaginator.Report"`, an `Outer.Inner` self-reference with no package prefix) still needs
// its outer segment resolved, the same as a fully bare name would. `?`/`,`/`<`/`>`/`[]` naturally
// fall outside `\w`, so they need no special handling -- they just end up back in the untouched
// slices `qualifyReturnType` stitches around each match.
const TYPE_NAME_TOKEN = /[A-Za-z_$][A-Za-z0-9_$]*(?:\.[A-Za-z_$][A-Za-z0-9_$]*)*/g;
// The only keywords that can appear where a type name otherwise could inside a return type's own
// generic argument list -- a wildcard's own bound (`? extends Foo`, `? super Foo`). Excluded purely to
// avoid a pointless go-to-definition query on the keyword itself; skipping this wouldn't be wrong,
// jdtls would just find nothing there anyway, the same safe no-op every unqualifiable token already
// falls back to below.
const WILDCARD_BOUND_KEYWORDS = new Set(['extends', 'super']);
/**
 * Qualifies one bare simple name (already confirmed dot-free by `qualifyReturnType`) at its own real
 * position in that call's document, by asking jdtls what it actually resolves to -- rather than this
 * file parsing the declaring class's own `import` statements and reimplementing Java's
 * single-import/same-package/on-demand-import precedence itself, which is exactly the kind of
 * hand-rolled Java semantics this extension avoids everywhere else -- including `walkSupertypes`'s own
 * supertype-resolution walk, which still delegates entirely to jdtls for *which* types are supertypes;
 * only the narrow generic-argument extraction within one already-jdtls-identified hop reads source
 * text at all (see `walkSupertypes`'s own doc on the scope of that one exception). The position given
 * is exact -- it's a real offset into already-typechecked source, not a rendered hover (see
 * `resolveMemberReturnType`'s own doc on why) -- but the bare name itself is ambiguous the moment more
 * than one class on the classpath shares it: e.g. this project's own `com.letterboxd.om.Person` vs.
 * Supermodel's own `supermodel.user.Person`, both real, both indexed -- which is exactly why this
 * needs a live go-to-definition query at a real position, not a bare-FQCN-string guess the way
 * `resolveClass`'s own name-search-plus-package-check has to settle for (no live position behind a
 * `<jsp:useBean type="...">` value, for instance).
 *
 * For a `jdt://` target (any decompiled, binary-origin class -- a JAR dependency or a JDK module
 * alike, never this project's own `file://` source), the package is read directly off that URI's own
 * path (see `packageFromJdtUri`'s own doc), no further jdtls round trip needed. For a `file://` target
 * (this project's own source), there's no such shortcut -- the `Location` is instead matched against a
 * `vscode.executeWorkspaceSymbolProvider` lookup for the same bare name, purely to read its
 * `containerName` (jdtls's own package label for that exact symbol), never by opening the target file
 * and regexing its `package` line.
 *
 * Falls back to `bareName` unchanged (today's pre-qualification behavior) when: go-to-definition finds
 * nothing there (a primitive, `void`); the landing spot isn't actually `bareName`'s own type
 * declaration (see `isTypeDeclarationAt`'s own doc -- most commonly a raw, unbound generic type
 * variable like `T`, whose go-to-definition target is real but isn't a class); or (the `file://` path
 * only) no workspace-symbol candidate matches that exact location (jdtls not fully indexed yet). Same
 * "abstain rather than guess wrong" rule as every other lookup in this file.
 */
async function qualifyBareIdentifierAt(uri, position, bareName) {
    const definitions = await javaExtensionGateway_1.javaExtensionGateway.execute('vscode.executeDefinitionProvider', uri, position);
    const target = definitions?.[0];
    const location = !target ? undefined : 'targetUri' in target ? new vscode.Location(target.targetUri, target.targetSelectionRange ?? target.targetRange) : target;
    if (!location || !(await isTypeDeclarationAt(location.uri, location.range.start, bareName))) {
        return bareName;
    }
    const packageFromUri = packageFromJdtUri(location.uri);
    if (packageFromUri) {
        return `${packageFromUri}.${bareName}`;
    }
    const candidates = await javaExtensionGateway_1.javaExtensionGateway.execute('vscode.executeWorkspaceSymbolProvider', bareName);
    const match = candidates?.find((candidate) => candidate.name === bareName &&
        TYPE_KINDS.has(candidate.kind) &&
        candidate.location.uri.toString() === location.uri.toString() &&
        (candidate.location.range.contains(location.range.start) || location.range.contains(candidate.location.range.start)));
    return match?.containerName ? `${match.containerName}.${bareName}` : bareName;
}
/**
 * Whether `position` in `uri` is actually `simpleName`'s own type (class/interface/enum/record)
 * declaration -- not, say, a generic type *parameter*'s own declaration. `qualifyBareIdentifierAt`
 * needs this because go-to-definition on a *use* of a raw, unbound type variable (e.g. `T` in
 * `com.cactuslab.pages.AbstractPaginator<T>`'s own `public List<T> getPage()`) navigates to a real
 * location too -- `T`'s own declaration on the enclosing class's `<T>` clause -- indistinguishable from
 * a real class reference by "did go-to-definition find something" alone. Trusting that distinction
 * once produced a fabricated FQCN: pairing `T`'s own declaring file's package
 * (`com.cactuslab.pages`, off `AbstractPaginator.java`'s own `jdt://` path) with the bare name it
 * wasn't actually naming a class of, `"com.cactuslab.pages.T"` -- which a *later*, unrelated generic
 * substitution then matched as a plain identifier token and swapped for a real substituted value,
 * silently producing `"com.cactuslab.pages.Person"`: a package that's real, holding a class that never
 * existed, for a `Person` the substitution never meant to end up there.
 *
 * A class/interface/enum/record declaration's own `DocumentSymbol` is a `TYPE_KINDS` kind whose
 * `selectionRange` covers exactly its own name token; a type parameter's does not (jdtls doesn't
 * report type parameters via `executeDocumentSymbolProvider` as one at all), so requiring a `TYPE_KINDS`
 * match at this exact position is sufficient to tell them apart without hand-rolling that distinction.
 *
 * `uri` is opened first (`javaExtensionGateway.openDocument`) -- a never-opened document has no
 * model for jdtls to symbolize yet, so `executeDocumentSymbolProvider` silently comes back with
 * nothing for it otherwise (confirmed live: this was returning `undefined` even for `java.lang.String`'s
 * own decompiled `jdt://` source, which made every out-of-project return type -- not just an
 * unbound type variable -- fall back to its own bare, unqualified name).
 */
async function isTypeDeclarationAt(uri, position, simpleName) {
    await javaExtensionGateway_1.javaExtensionGateway.openDocument(uri);
    const docSymbols = await javaExtensionGateway_1.javaExtensionGateway.execute('vscode.executeDocumentSymbolProvider', uri);
    return Boolean(docSymbols && findTypeDeclarationAt(docSymbols, position, simpleName));
}
function findTypeDeclarationAt(symbols, position, simpleName) {
    for (const symbol of symbols) {
        // `stripGenericTypeParams` -- same reasoning as `findTypeSymbol`'s own use of it -- a generic
        // type's own `DocumentSymbol.name` can come back as e.g. `"List<E>"`, not just `"List"`.
        if (TYPE_KINDS.has(symbol.kind) && stripGenericTypeParams(symbol.name) === simpleName && symbol.selectionRange.contains(position)) {
            return symbol;
        }
        if (symbol.children?.length) {
            const nested = findTypeDeclarationAt(symbol.children, position, simpleName);
            if (nested) {
                return nested;
            }
        }
    }
    return undefined;
}
/**
 * Qualifies every bare simple name found in `text` into an FQCN -- not just a leading/outer type
 * (`"List"` -> `"java.util.List"`), but each of its generic type *arguments* too, at any nesting depth
 * (`"List<Person>"` -> `"java.util.List<com.letterboxd.om.Person>"`, `"Map<String, Person>"` -> both
 * arguments qualified, `"Map<String, List<Person>>"` -> all three). The one shared implementation for
 * every raw, bare-name-carrying span of Java source text this file ever reads off a real document --
 * `qualifyReturnType` (a member's own return-type text) and `resolveHopSubstitution` (a heritage
 * clause's own type-argument text, javaHeritageClause.ts's `HeritageTypeArgument`) both delegate here
 * rather than each independently re-walking bare tokens and re-deciding how to qualify each one. Before
 * `resolveHopSubstitution` reused this, `qualifyReturnType` was the only caller, and only ever handled
 * a return type's own *outer* type -- the generic-argument suffix, once split off, was reattached
 * completely unexamined, so a member declared e.g. `List<Person>` came back as `"java.util.List<Person>"`:
 * half-qualified, with `Person` left exactly as its declaring file wrote it (relying on that file's own
 * `import com.letterboxd.om.Person;`, invisible from here) -- indistinguishable downstream from a
 * genuinely bare, no-package-implied name, which is exactly what broke `resolveIterationElementType`'s
 * own `isValidElementType` check for a loop variable of this shape (`resolveClass("Person")` expects a
 * *default-package* class named `Person`, not `com.letterboxd.om.Person`, and there is no such class).
 *
 * `position` is `text`'s own first character's real position in `document` -- every match's own
 * position is computed in absolute document-offset space (`document.offsetAt(position)` plus the
 * token's own index into `text`, converted back via `document.positionAt`), correct even if `text`
 * itself ever wrapped onto a second line, rather than assuming everything sits on `position`'s own
 * line. Every match resolves independently and in parallel -- one bare name's ambiguity/resolution has
 * nothing to do with any other's.
 *
 * A dotted match isn't always already-qualified: a real FQCN's leading segment is a package,
 * conventionally lowercase (`"com.letterboxd.om.Person"`), but a same-compilation-unit nested-class
 * reference written as `Outer.Inner` (e.g. `ReportsPaginator`'s own `extends
 * AbstractCachedPaginator<ReportsPaginator.Report>`, self-qualifying its own nested `Report` without
 * any package prefix at all) is dotted too, yet was never qualified -- traced against that exact
 * heritage clause: the argument reached `resolveClass` as the bare text `"ReportsPaginator.Report"`,
 * which `splitFqcn` then read as simple name `Report` with an *empty* package (every segment before it
 * starting uppercase), never matching `Report`'s real declaring file (package
 * `com.letterboxd.paginator`), so the whole hierarchy walk abstained (`unresolvedIterationDiagnostic`)
 * for every `sm:forEach paginator="..."` over a `Paginator<Outer.Inner>` shaped this way.
 * Distinguished with the same `looksLikeTypeSegment` convention `splitFqcn` already uses to tell a
 * package segment from a type-nesting one: if the leading segment starts uppercase, it's an outer
 * type, not a package, and still needs resolving -- so only that leading segment (not the whole
 * dotted token) is handed to `qualifyBareIdentifierAt`, and its own `.Inner` suffix is reattached
 * unexamined afterwards, the
 * exact same "resolve the position that's actually pointing at a class" reasoning as the bare-name
 * case just above.
 */
async function qualifyBareIdentifiersIn(document, uri, text, position) {
    const matches = [...text.matchAll(TYPE_NAME_TOKEN)].filter((m) => (m[0].indexOf('.') === -1 || looksLikeTypeSegment(m[0])) && !WILDCARD_BOUND_KEYWORDS.has(m[0]));
    if (matches.length === 0) {
        return text;
    }
    const startOffset = document.offsetAt(position);
    const qualified = await Promise.all(matches.map((m) => {
        const dotIndex = m[0].indexOf('.');
        const outerName = dotIndex === -1 ? m[0] : m[0].slice(0, dotIndex);
        const nestedSuffix = dotIndex === -1 ? '' : m[0].slice(dotIndex);
        return qualifyBareIdentifierAt(uri, document.positionAt(startOffset + m.index), outerName).then((qualifiedOuter) => qualifiedOuter + nestedSuffix);
    }));
    let result = '';
    let lastEnd = 0;
    matches.forEach((m, i) => {
        result += text.slice(lastEnd, m.index) + qualified[i];
        lastEnd = m.index + m[0].length;
    });
    return result + text.slice(lastEnd);
}
async function qualifyReturnType(document, uri, span) {
    return qualifyBareIdentifiersIn(document, uri, span.text, span.position);
}
/** Thin `vscode.Uri` wrapper over `packageFromJdtPath` (jdtUri.ts) -- see that function's own doc for
 * what this reads and why. */
function packageFromJdtUri(uri) {
    return (0, jdtUri_1.packageFromJdtPath)(uri.scheme, uri.path);
}
// Session-long cache, same reasoning classpathResources.ts's per-module jar
// index uses: a class's own members don't change without the .java source
// itself changing, so re-resolving the same (fqcn, candidateNames) pair on
// every debounced re-validation of a JSP that references it -- previously
// cheap (one direct lookup), now potentially several jdtls round trips once
// `resolveInheritedMember`'s type-hierarchy walk gets involved -- is pure
// waste. Cleared whenever a .java file changes (see the fileWatcher in
// extension.ts) rather than tracked per-file, since mapping a cache key back
// to "which .java file could have affected this" isn't cheaply knowable
// here; a blanket clear-and-revalidate on any .java save is the same
// precision/cost tradeoff the tldWatcher already makes for TLD/global.jspf
// changes.
const memberReturnTypeCache = new Map();
/**
 * Clears every jdtls-result cache this file keeps (`resolveClass`'s, `resolveMemberReturnType`'s,
 * `resolveMethodOverloads`'s, `isAssignableTo`'s, and `resolveIterationElementType`'s) -- call after a
 * `.java` file changes, since any cached result for it could now be stale. One shared clear function,
 * rather than a separate one per cache the caller in `extension.ts` would have to remember to call
 * individually, since all five are invalidated by the exact same trigger.
 */
function clearJavaSymbolCaches() {
    classLocationCache.clear();
    memberReturnTypeCache.clear();
    methodOverloadsCache.clear();
    assignabilityCache.clear();
    iterationElementTypeCache.clear();
}
async function resolveMemberReturnType(fqcn, candidateNames) {
    const cacheKey = `${fqcn}#${candidateNames.join(',')}`;
    const cached = memberReturnTypeCache.get(cacheKey);
    if (cached) {
        return cached;
    }
    const result = resolveMemberReturnTypeUncached(fqcn, candidateNames);
    memberReturnTypeCache.set(cacheKey, result);
    // 'unknown' can mean "jdtls wasn't ready yet" -- a transient condition,
    // not a stable fact about the class the way 'found'/'missing' are. Caching
    // that would mean it never gets retried even after
    // trackJavaServerReadiness fires validateAllOpen() later, once jdtls
    // actually is ready -- so only a deterministic outcome stays cached.
    result.then((resolved) => {
        if (resolved.status === 'unknown') {
            memberReturnTypeCache.delete(cacheKey);
        }
    });
    return result;
}
/**
 * Resolves one EL chain hop against `type` -- shared by `VariableTypeResolver`'s chain-type walk
 * (`variableTypes.ts`) and `ElDiagnostics`'s per-usage validation walk (`elDiagnostics.ts`), which
 * both need to answer the exact same question ("what does the next segment resolve to against this
 * type?") and previously each had their own copy of this same branch. Checked in this order:
 * - A method call (`segment.callArgs` present) -- resolved overload-aware, via `resolveOverloadedCall`
 *   below (`knownTypes` is only ever needed for this case, to resolve a non-literal argument's own
 *   type). Checked first even for a segment that's *also* bracket/index access (see the next case)
 *   -- a suffix followed by its own call (`foo['bar'](x)`) is a real, if vanishingly rare (no
 *   confirmed usage in this codebase), shape the grammar allows; there's no meaningful "resolve the
 *   index, then call the result" model to fall back to here, so this just takes its normal, harmless
 *   course (failing to find a same-named method, since `segment.name` is a display label like
 *   `"[0]"` here, not a real member name).
 * - An integer-literal bracket index (`foo[0]`) against a `List<T>`/array-typed base -- resolved via
 *   `resolveIterationElementType`.
 * - Against a `Map<K,V>`-shaped type, any remaining segment -- a bare property access (`a.b`), a
 *   string-literal bracket index (`a['b']`), or even a *computed* bracket index (`a[x]`) -- resolves
 *   straight to `V`, rather than looking for a `getB()` method that was never going to exist
 *   (`java.util.Map` has no such getters for arbitrary keys). This is checked before either the
 *   computed-index bail or the getter-convention lookup below, and deliberately isn't gated on the
 *   index being a literal: unlike a bean getter, `Map<K,V>.get(Object)` returns `V` for *any* key, so
 *   which particular key is being looked up is never actually relevant to the resolved type -- this
 *   is the same "not a guess, that's what it actually is" fact `unwrapMapValueType`'s own doc leans
 *   on for the raw-`Map` case.
 * - A computed (non-literal) bracket index against anything else -- not resolved at all, same "don't
 *   guess" rule applied everywhere else in this file (unlike the `Map` case above, a real getter
 *   lookup here needs the actual property name, which a computed index doesn't statically have).
 * - Everything else -- a bare property access (`a.b`) or a string-literal bracket index (`a['b']`)
 *   against a non-`Map` type -- resolved by JavaBean getter convention first, falling back to a
 *   same-named plain field (`findMemberOrRecordComponent`'s own field-kind fallback) only once no
 *   getter exists -- e.g. `OAuthConstants.SESSION_AUTHENTICITY_TOKEN`, a page-imported class's
 *   `public static final` field, or an ordinary instance's own public field with no accessor. Keyed
 *   off whichever segment actually names the property (`segment.index.text` for the bracket case --
 *   `segment.name` is only a *display* label there, e.g. `"['b']"`, not a real member name;
 *   `segment.name` itself otherwise). Goes through `resolveMemberReturnType` -- which itself now
 *   substitutes `type`'s own type arguments into whatever it finds (see
 *   `resolveMemberReturnTypeUncached`'s own comment), so e.g. `Map.Entry<String,Foo>.getKey()`'s
 *   real, raw-source return type `K` still comes back as `java.lang.String`, not the bare `"K"` its
 *   declaration in the JDK actually reads.
 *
 * `resolveFunction`, when supplied, is passed straight through to `resolveOverloadedCall` -- only
 * needed there, to type a nested EL function call (e.g. `lfn:instantToDate(x)`) used as one of this
 * hop's own call arguments; see `inferArgumentType`'s own doc for why.
 */
async function resolveChainHop(type, segment, knownTypes, resolveFunction) {
    if (segment.callArgs !== undefined) {
        return resolveOverloadedCall(type, segment.name, segment.callArgs, knownTypes, resolveFunction);
    }
    if (segment.index?.literalKind === 'int') {
        const elementType = await resolveIterationElementType(type);
        return elementType ? { status: 'found', type: elementType, location: await resolveClass(elementType) } : { status: 'unknown' };
    }
    const mapValueType = unwrapMapValueType(type);
    if (mapValueType) {
        return { status: 'found', type: mapValueType, location: await resolveClass(mapValueType) };
    }
    if (segment.index && segment.index.literalKind === undefined) {
        return { status: 'unknown' }; // a computed index against a non-Map base -- don't guess
    }
    const propertyName = segment.index ? segment.index.text : segment.name;
    // `propertyName` itself is appended as a final candidate -- not a naming convention at all, same
    // shortcut `resolveMember` already takes for a literal EL function/tag method name (see this
    // function's own doc) -- so `findMemberOrRecordComponent`'s field-kind fallback has the real,
    // undecorated field name to search for once neither `getX`/`isX` matches a method.
    return resolveMemberReturnType(type, [...getterCandidateNames(propertyName), propertyName]);
}
/**
 * Resolves a chain-ending method call's overload -- unlike `resolveMemberReturnType`/`findMember`
 * elsewhere in this file (which land on "any" overload, since a call's *return type* alone rarely
 * needs disambiguating), a call's own arguments determine which overload actually runs at runtime,
 * and this extension validates the call's arguments/shows hover & "go to definition" against a
 * *specific* one, so picking the wrong one is user-visible (e.g. landing on
 * `String#replace(char,char)` instead of `String#replace(CharSequence,CharSequence)` for
 * `.replace('a','b')`). Not full Java overload resolution (no boxing/widening-preference rules, no
 * varargs) -- just enough to break the common "same arity, different types" tie without guessing
 * wrong:
 * 1. `resolveMethodOverloads` returning the literal `'unknown'` (its class or document symbols
 *    weren't available -- jdtls not ready) is the *only* "can't confirm" case; abstain (`'unknown'`)
 *    here too, same "don't assert an error case we can't actually confirm" rule as the
 *    record/inherited-member fallbacks elsewhere in this file. Anything else -- including a
 *    confidently-resolved, genuinely empty overload list (no method by this name exists at all) --
 *    is real information, not a reason to abstain. Filter to overloads whose arity matches
 *    `callArgs.length`; zero matches at this point (whether because there were no overloads of this
 *    name to begin with, or none share this call's argument count) is a real, deterministic
 *    `'missing'`.
 * 2. Exactly one arity match -- confident, done. This alone already disambiguates most real
 *    overloaded methods (most don't have two overloads sharing an arity).
 * 3. More than one (the `replace` case) -- infer each argument's own type once (`inferArgumentType`,
 *    shared with each candidate check rather than redone per candidate) and check it against each
 *    candidate's declared parameter types (`checkArgumentCompatibility`); a candidate is "plausible"
 *    if none of its arguments comes back confidently `'incompatible'` (an argument this can't type
 *    at all never rules a candidate out -- consistent with everywhere else in this extension
 *    abstaining rather than guessing). Exactly one plausible candidate -- confident, done (this is
 *    what correctly picks `CharSequence,CharSequence` over `char,char` for two `String` arguments).
 *    Otherwise (zero or more than one still plausible) -- genuinely can't disambiguate further; use
 *    the first arity match (or first plausible one, if any) as a best-effort guess so chain
 *    evaluation can still continue, but set `overloadWarning` so `ElDiagnostics` surfaces this as a
 *    Warning rather than silently trusting the guess.
 */
async function resolveOverloadedCall(type, methodName, callArgs, knownTypes, resolveFunction) {
    const overloads = await resolveMethodOverloads(type, methodName);
    if (overloads === 'unknown') {
        return { status: 'unknown' };
    }
    const arityMatches = overloads.filter((overload) => overload.paramTypes.length === callArgs.length);
    if (arityMatches.length === 0) {
        return { status: 'missing' };
    }
    if (arityMatches.length === 1) {
        const [only] = arityMatches;
        return { status: 'found', type: only.returnType, location: only.location };
    }
    const argTypes = await Promise.all(callArgs.map((arg) => inferArgumentType(arg, knownTypes, resolveFunction)));
    const plausible = [];
    for (const candidate of arityMatches) {
        let ruledOut = false;
        for (let i = 0; i < argTypes.length; i++) {
            const actualType = argTypes[i];
            if (!actualType) {
                continue;
            }
            const compatibility = await checkArgumentCompatibility(actualType, candidate.paramTypes[i]);
            if (compatibility === 'incompatible') {
                ruledOut = true;
                break;
            }
        }
        if (!ruledOut) {
            plausible.push(candidate);
        }
    }
    if (plausible.length === 1) {
        const [only] = plausible;
        return { status: 'found', type: only.returnType, location: only.location };
    }
    const fallback = plausible[0] ?? arityMatches[0];
    const overloadWarning = plausible.length === 0
        ? `No overload of "${methodName}" on ${type} has parameter types compatible with the given arguments -- showing "${fallback.paramTypes.join(', ')}" as a best guess.`
        : `${plausible.length} overloads of "${methodName}" on ${type} share this argument count and none could be ruled out -- showing "${fallback.paramTypes.join(', ')}" as a best guess.`;
    return { status: 'found', type: fallback.returnType, location: fallback.location, overloadWarning };
}
/**
 * A chain's base (segment 0) type -- either its literal type (see `ElChainSegment.literalType`'s
 * own doc in `jspScan.ts`) or, for an ordinary variable-rooted chain (`literalType` unset), its
 * looked-up type from `knownTypes`. Shared by `resolveChainType` and `resolveChainSegment` so
 * there's one place that knows a chain's base can be either kind, not two.
 */
function resolveBaseType(knownTypes, base) {
    return base.literalType ?? knownTypes.get(base.name);
}
/**
 * Walks a chain's segments from `knownTypes`, hop by hop, returning the FQCN reached after the
 * *last* segment -- or `undefined` the moment the base (variable or literal) or any hop is
 * unresolvable. `segments` must be non-empty. Each hop after the base is resolved via
 * `resolveChainHop` -- a property access or a method call, per that segment's own `callArgs`.
 */
async function resolveChainType(knownTypes, segments) {
    let current = resolveBaseType(knownTypes, segments[0]);
    for (let i = 1; current && i < segments.length; i++) {
        const lookup = await resolveChainHop(current, segments[i], knownTypes);
        current = lookup.status === 'found' ? lookup.type : undefined;
    }
    return current;
}
/**
 * Resolves what a chain's *last* segment refers to, for hover/"go to definition" on that segment.
 * Two cases:
 * - Just the bare base (`segments.length === 1`, e.g. `_viewings` in `${_viewings.latestViewing}`
 *   when that's the segment under the cursor, or a literal like `'/type/'` in `${'/type/'.concat(x)}`)
 *   -- there's no getter to resolve, so this shows/links the base's own known type directly via
 *   `resolveClass`.
 * - A property access (`segments.length >= 2`) -- walks every segment before the last one via
 *   `resolveChainType`, then resolves one more hop for the last one, same as before.
 * Returns `undefined` if the base or any earlier hop is unresolvable.
 */
async function resolveChainSegment(knownTypes, segments) {
    if (segments.length === 1) {
        const type = resolveBaseType(knownTypes, segments[0]);
        return type ? { type, location: await resolveClass(type) } : undefined;
    }
    const typeBeforeLast = await resolveChainType(knownTypes, segments.slice(0, -1));
    if (!typeBeforeLast) {
        return undefined;
    }
    const lookup = await resolveChainHop(typeBeforeLast, segments[segments.length - 1], knownTypes);
    return lookup.status === 'found' ? { type: lookup.type, location: lookup.location } : undefined;
}
// Sentinels for a literal argument's inferred "type" -- wrapped in angle brackets specifically so
// neither can ever collide with a real Java FQCN (invalid characters in a Java identifier), unlike
// e.g. a bare "number"/"null" string, which risk (however remotely) matching an actual simple class
// name somewhere on the classpath.
const NUMERIC_LITERAL_TYPE = '<number>';
const NULL_LITERAL_TYPE = '<null>';
// A string literal whose content is zero or one character, e.g. "''" or "'/'" -- unlike any other
// string literal, this is genuinely ambiguous against `char`/`Character` too (Jakarta EL's own
// `coerceToCharacter` rule accepts a length-0 String, coercing to ` `, or a length-1 one), so
// `checkArgumentCompatibility` treats it differently from `'java.lang.String'` for that one
// comparison; everything else about it (string-like params, numeric/boolean ambiguity) is identical
// to any other string literal.
const SINGLE_CHAR_LITERAL_TYPE = '<single-char>';
const STRING_LITERAL = /^(['"])[\s\S]*\1$/;
const NUMBER_LITERAL = /^-?\d+(\.\d+)?$/;
/**
 * Infers an EL literal's type from its raw source text -- a quoted string, `true`/`false`, a bare
 * number, or `null` -- returning `undefined` for anything else (a variable reference, an operator
 * expression, a nested call, ...), which isn't a literal this function attempts to classify.
 * `NUMERIC_LITERAL_TYPE`/`NULL_LITERAL_TYPE`/`SINGLE_CHAR_LITERAL_TYPE` are sentinels, not real
 * FQCNs -- see `checkArgumentCompatibility` for how they're treated. A string literal's content
 * (quotes excluded) being zero or one character is what distinguishes `SINGLE_CHAR_LITERAL_TYPE`
 * from the plain `'java.lang.String'` case.
 */
function inferLiteralType(text) {
    const stringMatch = STRING_LITERAL.exec(text);
    if (stringMatch) {
        return text.length - 2 <= 1 ? SINGLE_CHAR_LITERAL_TYPE : 'java.lang.String';
    }
    if (text === 'true' || text === 'false') {
        return 'boolean';
    }
    if (text === 'null') {
        return NULL_LITERAL_TYPE;
    }
    if (NUMBER_LITERAL.test(text)) {
        return NUMERIC_LITERAL_TYPE;
    }
    return undefined;
}
/**
 * Resolves an EL function call's return type -- `prefix:name(...)` -- by looking up its backing
 * Java class/method via `resolveFunction` and reading the method's return type off its own
 * declaration (`resolveMemberReturnType`). Shared by `inferElExpressionType`'s `Function` case
 * (el/elTypeInference.ts, a real EL expression anywhere it can appear) and `inferArgumentType`
 * below (specifically a call nested as one of another call's own arguments, e.g.
 * `lfn:formatISO8601UTC(lfn:instantToDate(x))`) -- one implementation of "what does this function
 * call resolve to", not two independent copies of the same `resolveFunction`-then-
 * `resolveMemberReturnType` pair.
 */
async function resolveElFunctionCallType(prefix, functionName, resolveFunction) {
    const fn = await resolveFunction(prefix, functionName);
    if (!fn) {
        return undefined;
    }
    const lookup = await resolveMemberReturnType(fn.className, [fn.methodName]);
    return lookup.status === 'found' ? lookup.type : undefined;
}
/**
 * Infers one call argument's EL type -- a literal via `inferLiteralType` (its own argument-
 * compatibility sentinels, e.g. `<number>`, distinct from a chain's single concrete FQCN), a
 * variable- or literal-rooted EL chain (`parseChain`, same real parse -- and so the same
 * literal-rooted-chain support -- as any other chain in this extension) resolved against
 * `knownTypes` (`resolveChainType` above), or a nested EL function call (e.g.
 * `lfn:instantToDate(x)` as an argument to an outer call) resolved via `resolveElFunctionCallType`
 * -- the same resolution `inferElExpressionType`'s `Function` case gives any other EL function
 * call.
 *
 * Used to be gated by a hand-rolled `^[A-Za-z_]\w*(\.[A-Za-z_]\w*)*$` regex before attempting
 * `parseChain`, on the theory that a dotted chain never contains an operator/space/paren -- but
 * `parseChain` itself is a real parse (`parseStandaloneElChain`, `el/elChainAdapter.ts`), not the
 * flat regex scan that guard predates, so it already returns `[]` on its own for anything that
 * isn't a genuine chain (an operator, a ternary, `foo(bar)` where `foo` isn't itself chain-rooted).
 * The regex's only remaining effect was excluding shapes `parseChain` *does* handle correctly --
 * a call or bracket access nested inside an argument (`_service.call('test'.concat('test1'))`'s
 * own argument, `_availabilityFilter.toggle(x)` passed as an argument to something else) -- so it's
 * gone; `segments.length` (same check `inferElExpressionType` itself uses) is the one place that
 * now decides "is this argument chain-shaped", not a second, narrower copy of that decision.
 *
 * `resolveFunction` is optional (some callers -- e.g. a chain walk with no `TldIndex` in scope --
 * have no way to supply one) and this simply abstains on a nested call when it's missing, same as
 * every other "can't confirm" case here.
 * `undefined` for anything else this can't confidently type -- an unresolvable/untyped chain, or a
 * more complex expression (an operator, a ternary) this extension has never attempted to type
 * anywhere else and shouldn't start attempting here -- so the caller abstains on that argument
 * rather than guessing.
 */
async function inferArgumentType(arg, knownTypes, resolveFunction) {
    const literalType = inferLiteralType(arg.text);
    if (literalType) {
        return literalType;
    }
    const { segments } = (0, jspScan_1.parseChain)(arg.text, arg.range[0]);
    if (segments.length) {
        return resolveChainType(knownTypes, segments);
    }
    if (!resolveFunction) {
        return undefined;
    }
    const node = (0, elParser_1.parseElExpression)(arg.text);
    return node.kind === 'Function' && node.prefix ? resolveElFunctionCallType(node.prefix, node.name, resolveFunction) : undefined;
}
exports.NUMERIC_TYPES = new Set([
    'int',
    'long',
    'double',
    'float',
    'short',
    'byte',
    'java.lang.Integer',
    'java.lang.Long',
    'java.lang.Double',
    'java.lang.Float',
    'java.lang.Short',
    'java.lang.Byte',
    'java.math.BigDecimal',
    'java.math.BigInteger',
    'java.lang.Number',
]);
const BOOLEAN_TYPES = new Set(['boolean', 'java.lang.Boolean']);
const STRING_LIKE_TYPES = new Set(['java.lang.String', 'java.lang.CharSequence']);
const CHAR_TYPES = new Set(['char', 'java.lang.Character']);
// int/Integer, long/Long, ... -- for the non-literal case, where the actual type is a real FQCN
// (never a bare primitive keyword -- `resolveChainType` always reports a Java type as jdtls does,
// which is never a primitive for an EL variable) but the declared parameter type might be.
exports.PRIMITIVE_WRAPPERS = new Map([
    ['int', 'java.lang.Integer'],
    ['long', 'java.lang.Long'],
    ['double', 'java.lang.Double'],
    ['float', 'java.lang.Float'],
    ['short', 'java.lang.Short'],
    ['byte', 'java.lang.Byte'],
    ['char', 'java.lang.Character'],
    ['boolean', 'java.lang.Boolean'],
]);
// `java.lang` is always implicitly imported, so Java source never needs to qualify these -- a
// method parameter's declared type read straight off its own source text (`extractMemberParamTypes`)
// or a chain's resolved return type (`extractMemberReturnType`, same raw-text extraction) can
// legitimately come back as either the bare simple name or the fully qualified form depending on
// which class's source happened to spell it which way, so both forms need to compare equal here --
// see `checkArgumentCompatibility`'s own `argTypes=["java.lang.String","String"]` history (the same
// underlying type inferred two different ways for two different arguments).
const JAVA_LANG_SIMPLE_NAMES = new Set(['String', 'Boolean', 'Byte', 'Character', 'Double', 'Float', 'Integer', 'Long', 'Short', 'Object', 'Number', 'CharSequence']);
function normalizeJavaLangType(type) {
    return JAVA_LANG_SIMPLE_NAMES.has(type) ? `java.lang.${type}` : type;
}
/**
 * Checks `rawActualType` (from `inferArgumentType` -- a literal sentinel, or a real FQCN/simple
 * name) against `rawDeclaredParamType` (from a TLD `<function-signature>`, always fully qualified,
 * or a resolved Java method parameter, which -- unlike a TLD signature -- can be a bare simple name
 * for any `java.lang.*` type, per `normalizeJavaLangType`'s own comment). Both are normalized to the
 * fully qualified form up front so a comparison never silently misses just because one side happened
 * to spell a `java.lang` type differently than the other.
 *
 * The literal cases below follow Jakarta EL's own `coerceToType` rules where they're
 * unambiguous (e.g. a `Number` never coerces to `boolean`, so numeric-vs-boolean is a confident
 * `'incompatible'`) but deliberately abstain (`'unknown'`) rather than guess on the genuinely
 * content-dependent cases EL *does* support (e.g. whether a specific string literal would coerce to
 * a number depends on whether its content actually parses as one, which this doesn't attempt to
 * re-derive) -- `'incompatible'` is reserved for combinations that can never work, not ones that
 * merely aren't confidently known to work. A string literal's *length* is the one piece of content
 * this does inspect (via `SINGLE_CHAR_LITERAL_TYPE`), since it alone (not the string's actual
 * characters) already settles whether `coerceToCharacter` could ever apply.
 */
async function checkArgumentCompatibility(rawActualType, rawDeclaredParamType) {
    const declaredParamType = normalizeJavaLangType(rawDeclaredParamType);
    if (declaredParamType === 'java.lang.Object' || rawActualType === NULL_LITERAL_TYPE) {
        return 'compatible';
    }
    if (rawActualType === NUMERIC_LITERAL_TYPE) {
        if (exports.NUMERIC_TYPES.has(declaredParamType)) {
            return 'compatible';
        }
        return STRING_LIKE_TYPES.has(declaredParamType) || CHAR_TYPES.has(declaredParamType) ? 'unknown' : 'incompatible';
    }
    if (rawActualType === 'boolean') {
        // A literal `true`/`false` -- but this is also just plain "boolean" for a real boolean-typed
        // chain, so this branch covers both; either way the EL coercion rules are the same (a Boolean
        // never coerces to a Number, and vice versa).
        if (BOOLEAN_TYPES.has(declaredParamType)) {
            return 'compatible';
        }
        return STRING_LIKE_TYPES.has(declaredParamType) ? 'unknown' : 'incompatible';
    }
    // A single-character string literal (e.g. `'/'`) is genuinely ambiguous specifically against
    // `char`/`Character` (Jakarta EL's own `coerceToCharacter` rule accepts a length-1 String) --
    // everything else about it behaves exactly like any other String, so it's treated as one (with
    // `java.lang.String` as its real, resolvable type) from here on, this flag aside.
    const isSingleCharStringLiteral = rawActualType === SINGLE_CHAR_LITERAL_TYPE;
    const actualType = isSingleCharStringLiteral ? 'java.lang.String' : normalizeJavaLangType(rawActualType);
    if (actualType === 'java.lang.String') {
        if (STRING_LIKE_TYPES.has(declaredParamType)) {
            return 'compatible';
        }
        if (CHAR_TYPES.has(declaredParamType)) {
            // Unlike the numeric/boolean ambiguity right below, a string's length -- not just its content
            // -- already settles this for any literal that isn't exactly one character: EL's own
            // `coerceToCharacter` rule is defined in terms of the string's length, so a longer (or empty)
            // one can never coerce to a `char`, confidently, not just "unconfirmed".
            return isSingleCharStringLiteral ? 'unknown' : 'incompatible';
        }
        if (exports.NUMERIC_TYPES.has(declaredParamType) || BOOLEAN_TYPES.has(declaredParamType)) {
            return 'unknown';
        }
        // Falls through, unlike the numeric-literal/boolean cases above: `java.lang.String` is a real,
        // resolvable class (those two are synthetic sentinels with no class `isAssignableTo` could ever
        // resolve), so a declared type that isn't one of the well-known coercion-ambiguous cases above
        // still deserves a real assignability check rather than an automatic 'incompatible' -- e.g. a
        // custom interface `String` happens to implement that isn't already covered by
        // `STRING_LIKE_TYPES` above.
    }
    // Either direction: `actualType` is a resolved chain's type, which can itself be a bare
    // primitive keyword (e.g. "int", read straight off a getter's source text by
    // `extractMemberReturnType`) just as easily as `declaredParamType` can be.
    const primitiveWrapperMatch = exports.PRIMITIVE_WRAPPERS.get(declaredParamType) === actualType || exports.PRIMITIVE_WRAPPERS.get(actualType) === declaredParamType;
    if (actualType === declaredParamType || primitiveWrapperMatch) {
        return 'compatible';
    }
    // `declaredParamType` is a primitive keyword (`PRIMITIVE_WRAPPERS`, reused here as the set of the 8
    // primitive names rather than a second one) and `actualType` didn't match it or its own wrapper above
    // -- if `actualType` is itself some *other* real class/interface (not a primitive keyword), no Java
    // coercion ever takes an arbitrary reference type to a primitive (only its own exact wrapper unboxes,
    // already ruled out by `primitiveWrapperMatch`), so this is confidently `'incompatible'`, not
    // `'unknown'`: without this, `isAssignableTo(actualType, declaredParamType)` below would call
    // `resolveClass("int")`, find no such class (primitives have no document symbol), and abstain --
    // silently treating "can never work" the same as "couldn't check". Left as `'unknown'` when
    // `actualType` is itself a *different* primitive keyword (e.g. `double` against a declared `int`):
    // Java's own widening/narrowing rules could still make that compatible, and this file doesn't model
    // them (see this function's own doc), so guessing `'incompatible'` there would risk being wrong in the
    // other direction.
    if (exports.PRIMITIVE_WRAPPERS.has(declaredParamType) && !exports.PRIMITIVE_WRAPPERS.has(actualType)) {
        return 'incompatible';
    }
    const assignable = await isAssignableTo(actualType, declaredParamType);
    return assignable === undefined ? 'unknown' : assignable ? 'compatible' : 'incompatible';
}
/**
 * Substitutes every reference to one of `span`'s own method-level type parameters (e.g. `T` in `<T
 * extends IFilmable> ICQBPaginator<T, T, T> getFilmListEntryPaginator()`) with its own declared bound
 * (JLS 4.6 -- the erasure of a type variable is the erasure of its leftmost bound), wherever it occurs
 * in `qualifiedType` -- not just when the *entire* return type text is the bare type parameter (e.g. `P
 * getProgressPaginator()`), but equally a nested occurrence inside the return type's own generic
 * arguments (`T` inside `ICQBPaginator<T, T, T>`). `span.methodTypeParams` is `[]` for an ordinary,
 * non-generic method, so this is a no-op there -- `qualifiedType` is returned unchanged.
 *
 * Reuses `typeVariableSubstitution`'s own raw-instantiation branch (`instantiatedArgs: undefined` ->
 * every param erases to its own bound) and `substituteTypeVariables`'s own token-replace -- the same
 * machinery `rootSubstitutionFor` already applies for a *class*-level type variable referenced with no
 * type argument at all -- rather than a second, narrower, hand-rolled implementation of the identical
 * rule scoped to just the whole-span shape: a method-level type parameter needs the exact same
 * "unbound erases to its bound, everywhere it's referenced" treatment a class-level one already gets,
 * for the exact same reason (nothing else in this file's substitution pipeline is scoped to a method's
 * own type parameters at all, so an unbound one would otherwise survive as literal, bare text
 * indistinguishable from a real, resolved class -- e.g. `resolveClass("T")`'s own single-candidate
 * fallback could easily "resolve" it to some unrelated real class named `T` somewhere on the classpath).
 *
 * `qualifiedType` is `span.text` *after* `qualifyReturnType` -- run once on the raw source text, same
 * as any other return type -- rather than substituting first: `qualifyBareIdentifierAt` already leaves
 * a bare type-variable reference like `T` untouched (see `isTypeDeclarationAt`'s own doc on why a
 * go-to-definition hit on a type parameter's own declaration isn't a class to qualify), so qualifying
 * first and substituting after is the same order `rootSubstitution` already uses, and avoids redoing
 * `qualifyDeclaredParamBounds`'s own position math against a text this function has already rewritten.
 */
async function substituteMethodTypeParameters(document, span, qualifiedType) {
    if (span.methodTypeParams.length === 0) {
        return qualifiedType;
    }
    const qualifiedParams = await qualifyDeclaredParamBounds(document, 0, span.methodTypeParams);
    return substituteTypeVariables(qualifiedType, typeVariableSubstitution(undefined, qualifiedParams));
}
/**
 * Resolves one of `candidateNames` against a type's own `docSymbols`/source text -- a literal
 * member match by name (a method first, matching every existing candidate-name convention this is
 * called with -- see `getterCandidateNames`/`setterCandidateNames`/`resolveMember`'s own doc; only if
 * every candidate misses as a method does this retry the same list against a plain field, e.g.
 * `OAuthConstants.SESSION_AUTHENTICITY_TOKEN`, a `public static final` field with no getter --
 * mirrors real `jakarta.el.BeanELResolver`/`StaticFieldELResolver`, both of which fall back to direct
 * field access only once a getter search comes up empty), or (only if *both* of those missed, and
 * only when `typeRange` is available) a record-component fallback within `typeRange` (`fqcn` might be
 * a record, whose accessors have no method body in source for jdtls's document-symbol outline to have
 * reported in the first place -- see `findRecordComponent`). Shared by `resolveMemberReturnTypeUncached`
 * (the type currently being resolved, which always has *some* range to fall back to -- see its own
 * comment) and `findMemberOnSupertype` (one ancestor visited while walking the hierarchy, which may
 * not) -- previously two hand-maintained copies of the identical sequence.
 *
 * `undefined` means none of those three steps matched anything at all -- distinct from
 * `{status: 'unknown'}`, which means a member *was* found but its type couldn't be read off its
 * source -- so each caller can still apply its own "abstain vs. treat as missing" rule for the
 * "nothing matched here" case (see each caller's own comment on why that differs between them).
 */
async function findMemberOrRecordComponent(uri, document, docSymbols, candidateNames, typeRange) {
    let member;
    for (const name of candidateNames) {
        member = findMember(docSymbols, name);
        if (member) {
            break;
        }
    }
    if (!member) {
        for (const name of candidateNames) {
            const candidate = findMember(docSymbols, name, 'field');
            // `isPublicField` (not a method-kind concern -- see its own doc) so a private/protected field
            // that happens to share a candidate name is treated the same as no match at all, not "found but
            // inaccessible": the search keeps going, same as if this field weren't declared here.
            if (candidate && isPublicField(document, candidate)) {
                member = candidate;
                break;
            }
        }
    }
    if (member) {
        const location = new vscode.Location(uri, member.selectionRange);
        const span = extractMemberReturnType(document, member);
        // The member exists but its return type couldn't be parsed out of its own
        // source -- an unexpected shape we don't recognize, not proof there's no
        // such member, so this stays "unknown" rather than "missing".
        if (!span) {
            return { status: 'unknown' };
        }
        const type = await substituteMethodTypeParameters(document, span, await qualifyReturnType(document, uri, span));
        return { status: 'found', type, location };
    }
    if (!typeRange) {
        return undefined;
    }
    const classText = document.getText(typeRange);
    const component = findRecordComponent(classText, candidateNames);
    if (!component) {
        return undefined;
    }
    const typeStart = document.offsetAt(typeRange.start);
    const location = new vscode.Location(uri, new vscode.Range(document.positionAt(typeStart + component.nameRange[0]), document.positionAt(typeStart + component.nameRange[1])));
    // Not run through `qualifyReturnType` -- `findRecordComponent` only reports the component's
    // name range, not its type's own position, so there's no anchor to point a go-to-definition query
    // at here. Left as the bare name `findRecordComponent` read off the record header, same
    // pre-existing "known gap" this had before `qualifyReturnType` existed.
    return { status: 'found', type: component.type, location };
}
async function resolveMemberReturnTypeUncached(fqcn, candidateNames) {
    const context = await resolveClassHierarchyContext(fqcn);
    // `context.outline` specifically, not just a missing `context` -- see `resolveClassHierarchyContext`'s
    // own doc: a caller that (unlike `isAssignableTo`/`resolveIterationElementTypeViaHierarchy`) also
    // needs to search *direct* members of `fqcn` itself has nothing to search without a real outline,
    // even though `resolveInheritedMember` below could still attempt a walk with just `context.position`.
    if (!context || !context.outline) {
        return { status: 'unknown' };
    }
    const { classLocation, rootSubstitution } = context;
    const { document: classDocument, docSymbols, typeSymbol } = context.outline;
    // Deliberately re-finds the type in `docSymbols` (a DocumentSymbol, whose
    // `range` is reliably the full declaration) rather than only ever reusing
    // `classLocation.range` from `resolveClass` -- that's a SymbolInformation
    // from the *workspace* symbol provider, and jdtls doesn't give its
    // `location.range` the same full-declaration guarantee for every symbol
    // kind (a record's came back name-only in practice, which made
    // `RECORD_HEADER` never match and every accessor -- including `checkUrl()`,
    // not just one of them -- read as "missing").
    const direct = await findMemberOrRecordComponent(classLocation.uri, classDocument, typeSymbol?.children ?? docSymbols, candidateNames, typeSymbol?.range ?? classLocation.range);
    if (direct) {
        // `fqcn` can itself be a concrete instantiation of a generic type (e.g.
        // `java.util.Map.Entry<java.lang.String,web.filter.SearchFilter.SearchFilterOption>`, the shape
        // `resolveIterationElementType` produces for a `Map`-iterating forEach's loop variable) -- a
        // *direct* member's return type, read from the type's own raw source, comes back in terms of
        // *its own* declared type parameters (`Map.Entry<K,V>.getKey()` reads as literally `"K"`), not
        // substituted against this specific instantiation. `context.rootSubstitution` closes that gap here.
        return direct.status === 'found' ? { ...direct, type: substituteTypeVariables(direct.type, rootSubstitution) } : direct;
    }
    // The inherited branch needs `context.rootSubstitution` seeded into `walkSupertypes` for exactly
    // the same reason the direct branch above needs it applied to what it finds -- see
    // `resolveClassHierarchyContext`'s own doc for the bug this fixes.
    const inherited = await resolveInheritedMember(classLocation.uri, context.position, candidateNames, rootSubstitution);
    return inherited ?? { status: 'missing' };
}
const MAX_SUPERTYPE_HOPS = 8;
// `JavaTypeHierarchyItem.range`/`.selectionRange` are plain LSP JSON (see this interface's own doc
// above), not real `vscode.Position` instances -- unlike a `DocumentSymbol`'s, which come from
// `executeDocumentSymbolProvider` and are already real ones. Needed wherever one of this file's own
// positions is sliced against a `vscode.TextDocument` (e.g. `resolveHopSubstitution`'s own source-text
// read), which a plain `{line, character}` object can't be used for directly.
function toPosition(pos) {
    return new vscode.Position(pos.line, pos.character);
}
// TypeHierarchyDirection enum from redhat.java's own bundle: children=0, parents=1, both=2.
const JAVA_TYPE_HIERARCHY_DIRECTION_PARENTS = 1;
async function openJavaTypeHierarchyRoot(uri, position) {
    const params = { textDocument: { uri: uri.toString() }, position: { line: position.line, character: position.character } };
    return javaExtensionGateway_1.javaExtensionGateway.execute('java.execute.workspaceCommand', 'java.navigate.openTypeHierarchy', JSON.stringify(params), JSON.stringify(JAVA_TYPE_HIERARCHY_DIRECTION_PARENTS), JSON.stringify(0));
}
async function resolveJavaSupertypes(item) {
    const resolved = await javaExtensionGateway_1.javaExtensionGateway.execute('java.execute.workspaceCommand', 'java.navigate.resolveTypeHierarchy', JSON.stringify(item), JSON.stringify(JAVA_TYPE_HIERARCHY_DIRECTION_PARENTS), JSON.stringify(1));
    return resolved?.parents ?? [];
}
function javaTypeHierarchyItemKey(item) {
    return `${item.uri}#${item.selectionRange.start.line}:${item.selectionRange.start.character}`;
}
/**
 * `findMemberOrRecordComponent` for one ancestor visited while walking the type hierarchy (see
 * `resolveInheritedMember`) -- kept as its own function, rather than called directly by
 * `resolveInheritedMember`'s visitor, because it deliberately treats "this ancestor's outline isn't
 * available" as `undefined` (keep walking -- a different branch, or the file just not being
 * open/indexed yet, shouldn't abort the whole search), where `resolveMemberReturnTypeUncached`
 * treats the same situation for the *starting* type as `'unknown'` (abstain entirely, the existing
 * and unchanged behavior for that case).
 */
/**
 * Applies `substitution` (see `resolveHopSubstitution`) to every occurrence of one of its own keys
 * in `text` -- e.g. `"List<T>"` + `{T: "com.letterboxd.om.Person"}` -> `"List<com.letterboxd.om.Person>"`.
 * Matched whole-token (`\b...\b`, via the tokenizing regex below), not as a plain substring
 * replacement, so a real (multi-letter) type-variable name like `"ENTITY"` can't accidentally match
 * inside an unrelated longer identifier -- the risk runs the other way too (a real class/package
 * segment coincidentally matching a short type-variable name like `"T"`), but that's the same
 * "vanishingly unlikely, and degrades to a no-op wrong guess rather than a plausible one" tradeoff
 * `resolveClass`'s own single-candidate fallback already accepts. A no-op (returns `text` unchanged)
 * when `substitution` is empty -- the common case for a non-generic hop -- so callers never need to
 * check emptiness themselves first.
 */
function substituteTypeVariables(text, substitution) {
    return substitution.size === 0 ? text : text.replace(/[A-Za-z_$][A-Za-z0-9_$]*/g, (token) => substitution.get(token) ?? token);
}
/**
 * Splits a generic type's own top-level type-argument list out of its text (e.g.
 * `"AbstractCQBPaginator<Person, Person, Person>"` -> `["Person", "Person", "Person"]`,
 * `"Map<String, List<Foo>>"` -> `["String", "List<Foo>"]`, note the inner `List<Foo>` staying
 * whole) -- splitting only on a comma outside any nested `<...>`, since an argument can itself be
 * generic. `undefined` for a name with no `<...>` at all (a non-generic type, or an already-bare
 * simple/qualified name), which every caller treats as "nothing to substitute here" rather than an
 * empty list -- those aren't the same thing (`Foo<>`, if it ever appeared, would be the latter).
 */
function parseTypeArgs(name) {
    const start = name.indexOf('<');
    if (start === -1 || !name.trimEnd().endsWith('>')) {
        return undefined;
    }
    const inner = name.slice(start + 1, name.lastIndexOf('>'));
    const args = [];
    let depth = 0;
    let current = '';
    for (const ch of inner) {
        if (ch === '<') {
            depth++;
        }
        else if (ch === '>') {
            depth--;
        }
        if (ch === ',' && depth === 0) {
            args.push(current.trim());
            current = '';
        }
        else {
            current += ch;
        }
    }
    const last = current.trim();
    if (last) {
        args.push(last);
    }
    return args;
}
const EMPTY_SUBSTITUTION = new Map();
/**
 * Computes the type-variable substitution map in effect *inside* one newly-visited supertype's own
 * frame, for `walkSupertypes` to both hand to `visit` and carry forward to the next hop -- what
 * closes the gap described in `README.md`'s "Unwrapping the loop variable's element type" known
 * limitation: `resolveInheritedMember` already finds *where* a member like `Paginator<T>.getPage()`
 * is declared, but previously read its return type (`"List<T>"`) as raw, unsubstituted source text,
 * with no way to know a concrete subclass several hops down actually bound `T` to e.g. `Person`.
 *
 * Two pieces, composed: (1) `child`'s own source text -- `child` is the type that was walked *from*
 * to reach `supertype`, sliced from just past its own name to the end of its declaration
 * (`child.selectionRange.end`/`child.range.end`, both already present on the `JavaTypeHierarchyItem`
 * the walk already fetched, no extra jdtls round trip needed) -- run through
 * `extractHeritageTypeArguments` (`javaHeritageClause.ts`) to read this hop's own `extends`/
 * `implements` clause's type arguments for `supertype` off `child`'s own source. These come back
 * expressed in terms of *child's* type variables, not necessarily already-concrete ones (a child
 * several hops down itself, not yet substituted), so each argument is first run through
 * `parentSubstitution` (the map already accumulated for `child`) to resolve as far as currently
 * known. (2) The supertype's own declared type-parameter names (e.g. `["T", "ENTITY", "Q"]`), read
 * via `extractDeclaredTypeParameters` off the supertype's own source text (`openTypeOutline`'s
 * already-open document, sliced the same way from the supertype's own `DocumentSymbol.selectionRange.
 * end`/`.range.end`), give the positions those resolved arguments bind to *from here on*, i.e. while
 * resolving anything found on this supertype itself or anything further up from it.
 *
 * Both extractions read source text, not any jdtls field, because there simply isn't one:
 * `resolveTypeHierarchy`'s own `TypeHierarchyItem` DTO (decompiled server-side, confirmed live) has
 * no field at all for a hop's own generic instantiation -- `supertype.name` is always jdtls's bare
 * simple class name, never the child's own generic-instantiation text this function used to assume
 * it sometimes carried -- and `DocumentSymbol.detail` is empty for a Java class/interface symbol too.
 * See `javaHeritageClause.ts`'s own doc for why this reading is narrowly scoped (clause-boundary
 * detection plus one entry's split, not a general heritage-clause parser) and why its `undefined`
 * (abstain) and `[]` (a real, raw-type answer) are different, both folded into "nothing to
 * substitute" by the early returns below.
 *
 * Returns `EMPTY_SUBSTITUTION` -- not an error, just "nothing to substitute at this hop" -- when
 * `extractHeritageTypeArguments` abstains, when this hop's own outline isn't available yet (same
 * "keep walking" reasoning as `findMemberOnSupertype`'s own `undefined` case), when
 * `extractDeclaredTypeParameters` abstains on the supertype's own source, or when the argument count
 * doesn't line up with the declared parameter count (shouldn't happen for well-formed Java, but
 * mismatched counts would silently misalign which argument binds to which parameter -- the same
 * "abstain rather than guess wrong" rule as everywhere else in this file, not a guess this makes
 * instead). Never throws -- `walkSupertypes`' own frontier expansion has no try/catch of its own
 * around this, unlike `resolveInheritedMember`/`isAssignableTo`'s outer ones, so an unexpected jdtls
 * response or document-open failure here needs to degrade in place rather than abort the whole walk.
 */
async function resolveHopSubstitution(child, supertype, parentSubstitution) {
    try {
        const childUri = vscode.Uri.parse(child.uri);
        const childDocument = await vscode.workspace.openTextDocument(childUri);
        const childNameEndOffset = childDocument.offsetAt(toPosition(child.selectionRange.end));
        const sourceAfterChildName = childDocument.getText(new vscode.Range(toPosition(child.selectionRange.end), toPosition(child.range.end)));
        const rawArgs = (0, javaHeritageClause_1.extractHeritageTypeArguments)(sourceAfterChildName, supertype.name);
        if (!rawArgs) {
            return EMPTY_SUBSTITUTION;
        }
        // Each raw argument is qualified at its own real position in `childDocument` *before*
        // `parentSubstitution` is applied -- e.g. `Person` (from `extends AbstractCQBPaginator<Person,
        // Person, Person>`, relying on this file's own `import com.letterboxd.om.Person;`, invisible from
        // here otherwise) needs its own real source position to point a go-to-definition query at
        // (`qualifyBareIdentifiersIn`, the same primitive `qualifyReturnType` already uses for a member's
        // own return-type text); a raw type-*variable* reference instead (e.g. a hop that just passes an
        // outer `T` straight through) has no class of its own to qualify and is correctly left bare by
        // that same call (see `isTypeDeclarationAt`'s own doc), so it's still a valid substitution key by
        // the time `substituteTypeVariables` runs next. Doing this the other way around -- substituting
        // first, then trying to qualify whatever text that produced -- would have nothing to qualify: a
        // substituted value is a computed string with no real backing document position left to query.
        const qualifiedArgs = await Promise.all(rawArgs.map((arg) => qualifyBareIdentifiersIn(childDocument, childUri, arg.text, childDocument.positionAt(childNameEndOffset + arg.offset))));
        const resolvedArgs = qualifiedArgs.map((text) => substituteTypeVariables(text, parentSubstitution));
        const outline = await openTypeOutline(vscode.Uri.parse(supertype.uri), supertype.name);
        if (!outline?.typeSymbol) {
            return EMPTY_SUBSTITUTION;
        }
        const sourceAfterSupertypeName = outline.document.getText(new vscode.Range(outline.typeSymbol.selectionRange.end, outline.typeSymbol.range.end));
        const ownParams = (0, javaHeritageClause_1.extractDeclaredTypeParameters)(sourceAfterSupertypeName);
        if (!ownParams) {
            return EMPTY_SUBSTITUTION;
        }
        const qualifiedOwnParams = await qualifyDeclaredParamBounds(outline.document, outline.document.offsetAt(outline.typeSymbol.selectionRange.end), ownParams);
        return typeVariableSubstitution(resolvedArgs, qualifiedOwnParams);
    }
    catch {
        return EMPTY_SUBSTITUTION;
    }
}
/**
 * Builds the type-variable substitution map for one type's own declared parameters, given the
 * concrete (or still-partially-substituted) arguments it was instantiated with -- e.g.
 * `instantiatedArgs: ["java.lang.String", "web.filter.SearchFilter.SearchFilterOption"]` against
 * `ownParams: [{name: "K", ...}, {name: "V", ...}]` (read off the declaring type's own source via
 * `extractDeclaredTypeParameters`) -> `{K: "java.lang.String", V:
 * "web.filter.SearchFilter.SearchFilterOption"}`.
 *
 * Shared by two call sites that are really the same computation anchored at different points in a
 * hierarchy walk: `resolveHopSubstitution` (one supertype hop up from a concrete instantiation) and
 * `rootSubstitutionFor` (the *starting* type itself, for a direct -- not inherited -- member's own
 * declared return type). Positional, not name-pattern-based -- works for any number of type
 * parameters in any order (confirmed against this codebase's own three-argument
 * `AbstractCQBPaginator<Person, Person, Person>`, see the README's "Unwrapping the loop variable's
 * element type"), not just the common one-or-two-argument `List<T>`/`Map<K,V>` shapes.
 *
 * `instantiatedArgs` empty -- `undefined` (`rootSubstitutionFor`'s `parseTypeArgs`, for no `<...>` at
 * all) or `[]` (`resolveHopSubstitution`'s `extractHeritageTypeArguments`, for a heritage entry
 * written with no `<...>` of its own, e.g. plain `extends Foo`; see that function's own doc on why
 * `[]` there is a real, different answer from `undefined`, not an equivalent one) -- is a *raw*
 * reference to a generic type, e.g. a `<jsp:useBean type="com.letterboxd.om.ICommentable">` with no
 * type argument. Per JLS 4.6, every one of `ownParams`' own type variables erases to its own declared
 * bound in that case, not to nothing: substituting nothing here previously left the bare, unbound
 * type-variable name (e.g. `TComment`, `ICommentable<TComment extends AbstractComment>`'s own
 * parameter) to survive as literal text into whatever member/element type this substitution
 * eventually feeds -- indistinguishable downstream from a real, resolved class, and occasionally even
 * validated as one purely by `resolveClass`'s own same-simple-name fallback coincidentally matching an
 * unrelated real class. Substituting the declared bound instead means every consumer of this map --
 * direct- and inherited-member lookup, iteration-element-type, method-overload collection, all of
 * which already share this one function -- gets the correct erased type for free, with no separate
 * validation of its own needed to catch the unbound case. Both callers already qualify each bound into
 * a real FQCN (`qualifyDeclaredParamBounds`) before it ever reaches here, the same treatment a
 * heritage argument's own text already gets, so this never substitutes a bare, un-package-qualified
 * name either.
 *
 * `EMPTY_SUBSTITUTION` when `ownParams` is `undefined` (the declaring side's own source couldn't be
 * read -- see `extractDeclaredTypeParameters`'s own doc on when it abstains), or when
 * `instantiatedArgs` is given and non-empty but its count doesn't match `ownParams`' (shouldn't happen
 * for well-formed Java, but a mismatch would silently misalign which argument binds to which parameter
 * -- "abstain rather than guess wrong", same rule as everywhere else in this file).
 */
function typeVariableSubstitution(instantiatedArgs, ownParams) {
    if (!ownParams) {
        return EMPTY_SUBSTITUTION;
    }
    if (!instantiatedArgs || instantiatedArgs.length === 0) {
        return new Map(ownParams.map((param) => [param.name, param.bound]));
    }
    if (ownParams.length !== instantiatedArgs.length) {
        return EMPTY_SUBSTITUTION;
    }
    return new Map(ownParams.map((param, i) => [param.name, instantiatedArgs[i]]));
}
/**
 * Qualifies each of `ownParams`' own bounds into a real FQCN (`qualifyBareIdentifiersIn`) -- the same
 * treatment a heritage argument's own raw text already gets in `resolveHopSubstitution`, so a raw-type
 * erasure fallback in `typeVariableSubstitution` substitutes e.g. `com.letterboxd.om.AbstractComment`,
 * not the bare `AbstractComment` its declaring source actually wrote (relying on that file's own
 * `import com.letterboxd.om.AbstractComment;`, invisible from here). `baseOffset` is the
 * `sourceAfterTypeName` `extractDeclaredTypeParameters` originally read `ownParams` from own start
 * offset in `document` -- the same document `DeclaredTypeParameter.boundOffset` is relative to. A
 * param with no `boundOffset` (the default `java.lang.Object` bound, with no `extends` clause to point
 * at) needs no lookup -- it's already a real FQCN.
 */
async function qualifyDeclaredParamBounds(document, baseOffset, ownParams) {
    return Promise.all(ownParams.map(async (param) => {
        if (param.boundOffset === undefined) {
            return param;
        }
        const bound = await qualifyBareIdentifiersIn(document, document.uri, param.bound, document.positionAt(baseOffset + param.boundOffset));
        return { ...param, bound };
    }));
}
/**
 * The one place in this file that opens a type's outline -- its `DocumentSymbol[]` (via
 * `executeDocumentSymbolProvider`) and its own `DocumentSymbol` within that (`findTypeSymbol`) -- given
 * a `uri` already known to point at it and its simple name. A fresh root lookup
 * (`resolveClassHierarchyContext`, the one place every *root* lookup -- `resolveMemberReturnTypeUncached`,
 * `resolveMethodOverloadsUncached`, `isAssignableTo`, `resolveIterationElementTypeViaHierarchy` -- now
 * goes through) and a hop reached mid-walk (`findMemberOnSupertype`, `findAllOverloadsOnSupertype`,
 * `resolveHopSubstitution`) are the same operation -- "open this URI's outline, find this simple name's
 * own symbol in it" -- with no behavioral difference between them; before `resolveClassHierarchyContext`
 * existed, every one of those root lookups independently re-ran the same `executeDocumentSymbolProvider`+
 * `findTypeSymbol` pair (and, worse, each separately decided whether to also compute a root-level
 * generic substitution from what it found -- two of them didn't, which is what let a starting type's own
 * type variable, referenced in its own heritage clause, survive unsubstituted all the way up an inherited
 * lookup).
 *
 * `undefined` -- "nothing usable here" -- only when `executeDocumentSymbolProvider` itself comes back
 * empty (jdtls not ready, or the file isn't open/indexed); `typeSymbol` inside the result can still be
 * `undefined` on its own (the outline came back, but no symbol matched `simpleName` in it), which every
 * caller already has its own fallback for (most fall back to the whole top-level `docSymbols`).
 */
async function openTypeOutline(uri, simpleName) {
    const docSymbols = await javaExtensionGateway_1.javaExtensionGateway.execute('vscode.executeDocumentSymbolProvider', uri);
    if (!docSymbols) {
        return undefined;
    }
    const document = await vscode.workspace.openTextDocument(uri);
    const typeSymbol = findTypeSymbol(docSymbols, simpleName);
    return { document, docSymbols, typeSymbol };
}
/**
 * The type-variable substitution in effect for a *root* type's own directly-declared members --
 * `fqcn` itself can be a concrete generic instantiation (e.g. `"Map.Entry<String,Foo>"`), whose
 * `typeSymbol` (from `openTypeOutline`) own declared parameter names are read off its source text
 * (`document`, sliced from `typeSymbol.selectionRange.end` to `typeSymbol.range.end`) via
 * `extractDeclaredTypeParameters` -- the same source `resolveHopSubstitution` reads for a supertype's
 * declared parameters, not `typeSymbol.name`, for the same reason given in that function's own doc.
 * Positionally matching that against `fqcn`'s own instantiated arguments via `typeVariableSubstitution`
 * is exactly `resolveHopSubstitution`'s own computation, just anchored at the walk's root instead of
 * one hop up it. Shared by every caller that needs this root-level substitution
 * (`resolveMemberReturnTypeUncached`, `resolveMethodOverloadsUncached`,
 * `resolveIterationElementTypeViaHierarchy`) instead of each re-deriving the same expression
 * independently.
 */
async function rootSubstitutionFor(fqcn, document, typeSymbol) {
    if (!document || !typeSymbol) {
        return EMPTY_SUBSTITUTION;
    }
    const sourceAfterName = document.getText(new vscode.Range(typeSymbol.selectionRange.end, typeSymbol.range.end));
    const ownParams = (0, javaHeritageClause_1.extractDeclaredTypeParameters)(sourceAfterName);
    if (!ownParams) {
        return EMPTY_SUBSTITUTION;
    }
    const qualifiedOwnParams = await qualifyDeclaredParamBounds(document, document.offsetAt(typeSymbol.selectionRange.end), ownParams);
    return typeVariableSubstitution(parseTypeArgs(fqcn), qualifiedOwnParams);
}
async function findMemberOnSupertype(uri, simpleName, candidateNames, substitution) {
    const outline = await openTypeOutline(uri, simpleName);
    if (!outline) {
        return undefined;
    }
    const found = await findMemberOrRecordComponent(uri, outline.document, outline.typeSymbol?.children ?? outline.docSymbols, candidateNames, outline.typeSymbol?.range);
    // Only a `'found'` result has a `type` text to substitute -- `'unknown'` carries no type at all,
    // and `undefined` ("nothing matched here, keep walking") isn't this hop's result to modify either.
    return found?.status === 'found' ? { ...found, type: substituteTypeVariables(found.type, substitution) } : found;
}
/**
 * Breadth-first walk up a type's supertype hierarchy -- via jdtls's own
 * type-hierarchy protocol (see `JavaTypeHierarchyItem` above) -- one hop of
 * supertypes at a time, calling `visit` on each newly-seen supertype and
 * stopping the moment it returns non-`undefined`. *Which* types are
 * supertypes, and in what order, is still resolved entirely by jdtls, not by
 * this file parsing `extends`/`implements` clauses: Java's heritage syntax
 * (generic bounds, `sealed ... permits`, multiple-interface lists) is exactly
 * the kind of thing this extension leaves to real Java tooling everywhere
 * else (see the README's opening paragraph) -- getting that parsing subtly
 * wrong would be worse than the gap this fills. The one narrow exception is
 * `resolveHopSubstitution`'s own generic-argument extraction (see its doc and
 * `javaHeritageClause.ts`'s): jdtls's own protocol has no field at all for a
 * hop's own generic instantiation, confirmed by decompiling its server-side
 * DTO, so reading that one piece off the declaring type's own source text is
 * the only remaining option -- narrowly scoped to finding clause boundaries
 * and splitting one already-identified entry, not a general heritage-clause
 * parser, and not a reversal of this function's own delegation to jdtls for
 * hierarchy resolution itself. Shared by `resolveInheritedMember` (visits
 * looking for a member) and `isAssignableTo` (visits looking for one specific
 * ancestor).
 *
 * `MAX_SUPERTYPE_HOPS` plus the `visited` set are just a generous,
 * cycle-proof backstop -- a real Java hierarchy this deep would be unusual.
 * Doesn't catch its own errors -- each caller's own try/catch decides the
 * right abstain value for a broken jdtls-protocol response, which differs
 * per caller (see `resolveInheritedMember`'s own comment on that).
 *
 * Also computes, and threads forward, each hop's own generic type-variable substitution map (see
 * `resolveHopSubstitution`) -- composed across hops as the walk climbs (a supertype's own map is
 * derived from its child's, not just its own immediate `extends` clause in isolation), so a member
 * found several hops up a generic hierarchy (e.g. `Paginator<T>.getPage()`, reached from a concrete
 * `PersonWithRolePaginator extends AbstractCQBPaginator<Person, Person, Person>`) can have its
 * return type's `T` resolved back to the concrete `Person` it was actually bound to, rather than
 * left as literal, unresolvable `"T"` text. `isAssignableTo`'s own visitor has no use for this (an
 * ancestor either is or isn't the target class, regardless of its generic arguments) and just
 * ignores the second argument -- it's still passed uniformly to every visitor rather than only to
 * `resolveInheritedMember`'s, since computing it is `walkSupertypes`' own concern either way (every
 * hop needs it computed to carry forward to the *next* hop, whether or not this particular caller's
 * `visit` reads it).
 */
async function walkSupertypes(uri, position, visit, 
// The substitution already in effect for the root itself, e.g. `{T: "Comment"}` for a walk starting
// at a concrete `CommentPaginator<Comment>` instantiation -- computed by the caller the same way
// `resolveMemberReturnTypeUncached` already does for a direct member's own return type (see
// `rootSubstitutionFor`'s own doc). No default on purpose, even though `isAssignableTo` always
// passes `EMPTY_SUBSTITUTION` (an ancestor either is or isn't the target class, regardless of the
// starting type's own type arguments) -- a default here once silently covered for
// `resolveInheritedMember` forgetting to seed this at all, on the (at-the-time-true, but never
// re-checked) assumption that neither of this function's two callers would ever start from a
// concrete instantiation. That assumption broke the moment `resolveMemberReturnTypeUncached`'s own
// *inherited* branch (unlike its *direct* one, which always computed this) needed exactly that --
// e.g. `CommentPaginator<AbstractComment>`'s own `T`, referenced in its *own* heritage clause
// (`extends AbstractCQBPaginator<T, T, T>`), never got bound before the walk started climbing,
// leaving literal `"T"` to survive all the way up to `AbstractPaginator.getPage(): List<T>`. Making
// this required means a future caller has to make an explicit choice instead of silently inheriting
// a default that quietly stops being safe.
rootSubstitution) {
    const root = await openJavaTypeHierarchyRoot(uri, position);
    if (!root) {
        return undefined;
    }
    let frontier = [{ item: root, substitution: rootSubstitution }];
    const visited = new Set([javaTypeHierarchyItemKey(root)]);
    for (let hop = 0; hop < MAX_SUPERTYPE_HOPS && frontier.length > 0; hop++) {
        const supertypeLists = await Promise.all(frontier.map(({ item }) => resolveJavaSupertypes(item)));
        const nextFrontier = [];
        for (let i = 0; i < frontier.length; i++) {
            const parentSubstitution = frontier[i].substitution;
            for (const supertype of supertypeLists[i]) {
                const key = javaTypeHierarchyItemKey(supertype);
                if (visited.has(key)) {
                    continue;
                }
                visited.add(key);
                const substitution = await resolveHopSubstitution(frontier[i].item, supertype, parentSubstitution);
                const result = await visit(supertype, substitution);
                if (result !== undefined) {
                    return result;
                }
                nextFrontier.push({ item: supertype, substitution });
            }
        }
        frontier = nextFrontier;
    }
    return undefined;
}
/**
 * Finds a member that isn't declared directly on the type at `position` by walking its supertype
 * hierarchy (`walkSupertypes`). e.g. `getUid()`, a `default` method declared on `IBoxdItEntity`, is
 * only reachable from `IViewingable` via `IPostered extends IBoxdItEntity` -- two hops up.
 */
async function resolveInheritedMember(uri, position, candidateNames, 
// The substitution already in effect for the root type itself -- see `walkSupertypes`' own
// `rootSubstitution` param, and `resolveClassHierarchyContext`'s own doc on why this closes the
// same gap for an inherited member that it already closed for a direct one. No default, same
// reasoning as `walkSupertypes`' own param: this function has exactly one caller
// (`resolveMemberReturnTypeUncached`), which always has a real substitution to pass (`context.rootSubstitution`,
// from `resolveClassHierarchyContext`) -- a default here would just reintroduce, one level up, the
// exact "silently fine until a caller actually needs it" gap that produced the bug this parameter
// exists to fix.
rootSubstitution) {
    // A thrown error here (e.g. redhat.java changing this undocumented
    // protocol's shape in some version) must never propagate: an uncaught
    // rejection would abort the whole *calling* ElDiagnostics.validate()
    // loop before it ever reaches `this.chainCollection.set(...)`, silently
    // freezing every diagnostic in the document at whatever the last
    // successful run produced -- worse than just this one lookup failing.
    // Reported as 'unknown' (abstain), the same as any other "couldn't check"
    // case in this file, with the actual error logged so it's visible in the
    // Extension Host output/console instead of just silently vanishing.
    try {
        return await walkSupertypes(uri, position, (supertype, substitution) => findMemberOnSupertype(vscode.Uri.parse(supertype.uri), supertype.name, candidateNames, substitution), rootSubstitution);
    }
    catch (error) {
        console.error('[vscode-jsp-linker] resolveInheritedMember failed:', error);
        return { status: 'unknown' };
    }
}
/**
 * Everything a hierarchy walk rooted at `fqcn` needs, resolved exactly once: `classLocation` (from
 * `resolveClass`); the `(uri, position)` anchor `walkSupertypes` needs to open the right root (a
 * `DocumentSymbol`'s `selectionRange` when the outline has one, `classLocation.range`'s own start
 * otherwise -- see `openTypeOutline`'s own doc for why `SymbolInformation.range` alone isn't a
 * reliable anchor: a position that doesn't actually land on the type silently no-ops the whole
 * supertype walk, e.g. `AnythingList`'s Lombok-generated `getPerson()`, reached from
 * `ProductionList`, once read as "missing" this way); `docSymbols`/`typeSymbol` themselves, for a
 * caller that also needs to search the type's own *direct* members, not just walk past it
 * (`resolveMemberReturnTypeUncached`, `resolveMethodOverloadsUncached`); and `rootSubstitution`
 * (`rootSubstitutionFor`) -- the substitution already in effect for `fqcn`'s own type variables,
 * needed by *every* caller of this function that ends up walking supertypes, not just the ones that
 * also search direct members (that requirement is exactly what four separate, independently-written
 * copies of this same setup sequence -- this function replaces all of them -- twice got wrong: the
 * inherited-member and inherited-overload walks each shipped without it before, in each case leaving
 * a starting type's own type variable, referenced in *its own* heritage clause, to survive as literal
 * unresolved text all the way up the walk instead of erasing to what it was actually instantiated
 * with).
 *
 * `docSymbols`/`typeSymbol` can each independently be `undefined` -- `docSymbols` only when jdtls's
 * own `executeDocumentSymbolProvider` came back empty entirely (not ready, or the file isn't
 * open/indexed), `typeSymbol` when `docSymbols` came back but no symbol in it matched `fqcn`'s own
 * simple name. A caller that only needs to *walk past* `fqcn` (`isAssignableTo`,
 * `resolveIterationElementTypeViaHierarchy`) can still do so with both unset -- `position` still
 * falls back to `classLocation.range.start`, and `rootSubstitutionFor` already tolerates a missing
 * `document`/`typeSymbol` by returning `EMPTY_SUBSTITUTION` -- but a caller that also needs to search
 * *direct* members of `fqcn` itself (`resolveMemberReturnTypeUncached`, `resolveMethodOverloadsUncached`)
 * has nothing to search without real `docSymbols`, and should treat that specifically (not a missing
 * `typeSymbol` alone, which `docSymbols` itself as a fallback already covers) as its own abstain case
 * -- see each of those functions' own doc.
 *
 * `undefined` only when `fqcn` itself doesn't resolve to a class at all (`resolveClass` came back
 * empty) -- there's no anchor of any kind to offer a caller at that point.
 */
async function resolveClassHierarchyContext(fqcn) {
    const classLocation = await resolveClass(fqcn);
    if (!classLocation) {
        return undefined;
    }
    // `resolveClass` above already stripped generics/arrays internally (via `splitFqcn`) to find
    // `classLocation` -- this is a second, independent split of the same `fqcn` for a different
    // purpose (finding the type's own symbol *within* that class's document), so it needs the same
    // stripping applied here too, not inherited from the call above.
    const simpleName = stripGenericsAndArrays(fqcn).split('.').pop();
    const outline = await openTypeOutline(classLocation.uri, simpleName);
    const rootSubstitution = await rootSubstitutionFor(fqcn, outline?.document, outline?.typeSymbol);
    return {
        classLocation,
        position: outline?.typeSymbol?.selectionRange.start ?? classLocation.range.start,
        outline,
        rootSubstitution,
    };
}
// Session-long cache, same reasoning/invalidation as `resolveMemberReturnType`'s own (see
// `clearJavaSymbolCaches`) -- overload selection (`resolveChainHop`) can call this once per
// argument per same-arity candidate, so an uncached type-hierarchy walk here would repeat the exact
// same jdtls round trips on every hop of every chain in every re-validation.
const assignabilityCache = new Map();
/**
 * Whether `subFqcn` is assignable to `superFqcn` -- an exact match, or `superFqcn` appears
 * somewhere in `subFqcn`'s own supertype hierarchy (interfaces included, same as
 * `resolveInheritedMember`'s walk). Used to validate an EL function/method-call argument's
 * inferred type against its declared parameter type (see `checkArgumentCompatibility`).
 *
 * `undefined` (abstain, same as everywhere else in this file) when either class doesn't resolve or
 * the walk itself can't be completed -- never a confident `false` in those cases, since that would
 * read as "definitely wrong" when it's really "couldn't check". Once the walk *does* complete,
 * though, exhausting the whole hierarchy without a match is treated as a confident `false` --
 * exactly the same risk `resolveMemberReturnTypeUncached` already accepts for "missing" (an
 * exhausted `resolveInheritedMember` walk becomes a confident `status: 'missing'`, not another
 * "unknown"), so this stays consistent with that rather than inventing a third, more cautious rule
 * just for this caller.
 */
async function isAssignableTo(subFqcn, superFqcn) {
    const cacheKey = `${subFqcn}#${superFqcn}`;
    const cached = assignabilityCache.get(cacheKey);
    if (cached) {
        return cached;
    }
    const result = isAssignableToUncached(subFqcn, superFqcn);
    assignabilityCache.set(cacheKey, result);
    // Same "don't cache abstaining" rule as `resolveMemberReturnType` -- a transient `undefined`
    // (jdtls not ready, or the walk itself failed) shouldn't stick around and block a retry later.
    result.then((resolved) => {
        if (resolved === undefined) {
            assignabilityCache.delete(cacheKey);
        }
    });
    return result;
}
async function isAssignableToUncached(subFqcn, superFqcn) {
    if (subFqcn === superFqcn) {
        return true;
    }
    const [context, superLocation] = await Promise.all([resolveClassHierarchyContext(subFqcn), resolveClass(superFqcn)]);
    if (!context || !superLocation) {
        return undefined;
    }
    // `subFqcn`/`superFqcn` can each denote the exact same class via a different name form -- most
    // commonly a Java method parameter's type read straight off its source text, which can be a
    // simple name resolved there only via that file's own single-type-import declaration (e.g.
    // "ContentAuthorisation"), vs a JSP `<jsp:useBean type="...">`, which has no import mechanism and
    // so always uses the fully qualified name ("com.letterboxd.ContentAuthorisation"). The
    // literal-string shortcut above only catches the case where both callers happened to use the same
    // name form; the walk below only ever checks *ancestors*, never the starting class itself, so
    // without this it would wrongly report the same class under two different name forms as unrelated.
    if (context.classLocation.uri.toString() === superLocation.uri.toString()) {
        return true;
    }
    try {
        // `EMPTY_SUBSTITUTION`, explicitly, not `context.rootSubstitution`: an ancestor either is or isn't
        // the target class regardless of `subFqcn`'s own type arguments, so there's no root instantiation
        // for this walk to seed.
        const found = await walkSupertypes(context.classLocation.uri, context.position, async (supertype) => ((await hierarchyItemIsFqcn(supertype, superFqcn)) ? true : undefined), EMPTY_SUBSTITUTION);
        return found ?? false;
    }
    catch (error) {
        console.error('[vscode-jsp-linker] isAssignableTo failed:', error);
        return undefined;
    }
}
/**
 * Builds a "no such member" diagnostic from a `resolveMemberReturnType` result, shared by every
 * caller that walks one against a resolved FQCN (`SetPropertyDiagnostics`, `TagFieldDiagnostics`,
 * `ElDiagnostics`'s chain walk) -- they still scan for and pick the FQCN/range/message/`source`
 * themselves (that part genuinely differs per construct), this just removes the repeated "if
 * missing, build an Error `vscode.Diagnostic`" boilerplate each one otherwise duplicated (via the
 * shared `createDiagnostic`, rather than yet another independent copy of that same construction).
 * `'found'` means there's nothing to flag (it resolved); `'unknown'` (this couldn't be checked --
 * abstain, don't guess) has its own sibling, `unknownMemberDiagnostic` below, rather than being
 * silently indistinguishable from `'found'` here the way it used to be -- every one of this
 * function's three callers should call that one too, not just this one, for the same lookup result.
 */
function missingMemberDiagnostic(document, range, fqcn, result, describe, source) {
    if (result.status !== 'missing') {
        return undefined;
    }
    return (0, diagnostics_1.createDiagnostic)(document, range, describe(fqcn), vscode.DiagnosticSeverity.Error, source);
}
/**
 * The `'unknown'` counterpart to `missingMemberDiagnostic` above -- surfaces the exact gap that
 * function's own doc used to describe as "nothing to flag": `fqcn` resolved to a real class, but
 * whether it actually has the member `describePositive` names couldn't be confirmed (most commonly,
 * its `.java` file isn't open/indexed by jdtls yet, or a member that *was* found had a return type
 * this file's source-text parsing didn't recognize). That's a real, temporary-or-not coverage gap,
 * not confirmation the member exists -- previously silent here (this file returned `undefined`, and
 * every caller just moved on as if the check had passed), which is exactly the class of "quiet
 * failure" this exists to stop: an actual absence of validation was indistinguishable from "checked,
 * and fine". `Information` severity, same as `untypedSourceDiagnostic`'s own "couldn't check this"
 * sibling for an unresolvable *source* variable -- this is the same admission one step later, once
 * the source resolved but the member check itself couldn't complete.
 *
 * Takes its own `describePositive` rather than reusing `missingMemberDiagnostic`'s `describe` --
 * that one is phrased as the negative "`fqcn` has no property/method X" (correct wording for a
 * confirmed absence), which doesn't compose into a sentence about *uncertainty*; this one instead
 * wants the positive noun phrase ("`fqcn`'s property X") that `Couldn't confirm whether ...` reads
 * naturally in front of. Each of this function's callers already has both phrasings close at hand
 * (the same field/segment name `missingMemberDiagnostic`'s own `describe` closes over).
 */
function unknownMemberDiagnostic(document, range, fqcn, result, describePositive, source) {
    if (result.status !== 'unknown') {
        return undefined;
    }
    return (0, diagnostics_1.createDiagnostic)(document, range, `Couldn't confirm whether ${describePositive(fqcn)}.`, vscode.DiagnosticSeverity.Information, source);
}
/** Convenience wrapper over `resolveMemberReturnType`+`getterCandidateNames` for hover/"go to definition", which only care about a resolved getter, not why one didn't resolve. */
async function resolveGetterReturnType(fqcn, propertyName) {
    const lookup = await resolveMemberReturnType(fqcn, getterCandidateNames(propertyName));
    return lookup.status === 'found' ? { type: lookup.type, location: lookup.location } : undefined;
}
/**
 * Unwraps a generic wildcard argument to the concrete type it actually reads as -- `"? extends Foo"`
 * -> `"Foo"` (an upper-bounded wildcard's elements are all at least a `Foo`, so reading one back out
 * really does give a `Foo`-typed reference), and a bare `"?"` or lower-bounded `"? super Foo"` ->
 * `"java.lang.Object"` (JLS capture conversion: without an upper bound, the only thing guaranteed
 * about an element read back out is *some* `Object` -- a fact, not a guess, the same reasoning
 * `unwrapMapValueType` already applies to a raw `Map`'s value type). Returns `arg` unchanged when it
 * isn't a wildcard at all.
 */
function stripWildcard(arg) {
    const trimmed = arg.trim();
    const extendsMatch = /^\?\s+extends\s+([\s\S]+)$/.exec(trimmed);
    if (extendsMatch) {
        return extendsMatch[1].trim();
    }
    return trimmed === '?' || /^\?\s+super\s+/.test(trimmed) ? 'java.lang.Object' : arg;
}
// The JDK collection-family interfaces (plus `java.lang.Iterable` itself) whose own sole type
// argument *is* the loop variable's element type directly, no hierarchy walk needed -- checked by
// exact bare-or-`java.util.`-qualified name, both forms seen on a chain-resolved type depending on
// where it was read from (see `stripGenericsAndArrays`'s own doc). Anything not on this list -- a
// custom class that only reaches `Iterable` through inheritance, e.g. a Paginator -- falls through to
// `resolveIterationElementType`'s real hierarchy walk below instead of going unrecognized.
const COLLECTION_FAMILY_NAMES = new Set([
    'List',
    'java.util.List',
    'Collection',
    'java.util.Collection',
    'Set',
    'java.util.Set',
    'Iterable',
    'java.lang.Iterable',
]);
// Same idea, for the two Map-family interfaces `directMapEntryType` below recognizes directly.
const MAP_FAMILY_NAMES = new Set(['Map', 'java.util.Map', 'SortedMap', 'java.util.SortedMap']);
/**
 * The no-hierarchy-walk fast path for a `List`/`Collection`/`Set`/`Iterable`-shaped type -- resolves
 * immediately, with no jdtls round trip, whenever `type`'s own bare name is already one of these (the
 * overwhelmingly common case: `List<Film>`, `Collection<Viewing>`, ...). Uses `parseTypeArgs`
 * (already relied on elsewhere in this file for real generic-signature parsing, e.g.
 * `resolveHopSubstitution`) rather than a hand-rolled capture group, so a wildcard-bounded argument
 * (`Collection<? extends AbstractProductionContribution>`, a perfectly ordinary covariant getter
 * return type) parses correctly instead of silently failing to match at all.
 */
function directIterableElementType(type) {
    if (!COLLECTION_FAMILY_NAMES.has(stripGenericsAndArrays(type))) {
        return undefined;
    }
    const rawArgs = parseTypeArgs(type);
    return rawArgs?.[0] ? stripWildcard(rawArgs[0]) : undefined;
}
/**
 * The `Map`/`SortedMap` counterpart to `directIterableElementType` -- see `resolveIterationElementType`'s
 * own doc for why iterating a `Map` yields one `Map.Entry<K,V>` per entry, not a bare value. A raw
 * `Map` (no type arguments at all) resolves to a bare `Map.Entry`: the JLS erases an ungenerified
 * `Map`/`SortedMap` usage to `Map<Object,Object>`, so this is a fact, not a guess (same reasoning
 * `unwrapMapValueType` already applies to its own raw-`Map` case).
 */
function directMapEntryType(type) {
    if (!MAP_FAMILY_NAMES.has(stripGenericsAndArrays(type))) {
        return undefined;
    }
    const rawArgs = parseTypeArgs(type);
    if (!rawArgs) {
        return 'java.util.Map.Entry';
    }
    return rawArgs.length === 2 ? `java.util.Map.Entry<${stripWildcard(rawArgs[0])},${stripWildcard(rawArgs[1])}>` : undefined;
}
const iterationElementTypeCache = new Map();
/**
 * Unwraps a `resolveGetterReturnType` result's collection element type, for a forEach-like binding's
 * loop variable (e.g. `List<Film>` -> `Film`, `java.util.SortedMap[]` -> `java.util.SortedMap`) --
 * the async, hierarchy-aware replacement for what used to be a fixed name allowlist. Three tiers,
 * cheapest first:
 *
 * 1. A raw array's element type is unambiguous (unlike a generic's type argument, which could hide
 *    wildcards or further nesting) -- e.g. JSTL's `sql:query` binds its `var` to a `Result`, whose
 *    `getRows()` returns a plain `SortedMap[]` rather than a `List<SortedMap>`.
 * 2. `directIterableElementType`/`directMapEntryType` -- the common, literally-`List`/`Map`-named
 *    case. Cheap (no jdtls round trip) to *extract* the candidate, but -- unlike its name once
 *    implied -- not returned unvalidated: `isValidElementType` below still confirms it resolves to
 *    a real class first, for the same reason tier 3 already does (see that check's own doc).
 * 3. A real type-hierarchy walk (`resolveIterationElementTypeViaHierarchy`, using the same
 *    BFS-with-generic-substitution `walkSupertypes` machinery `isAssignableTo`/`resolveInheritedMember`
 *    already use) for anything not literally named one of those -- a custom class (e.g. a Paginator)
 *    that only reaches `java.lang.Iterable`/`java.util.Map` through inheritance. Cached by resolved
 *    type string, same pattern as `isAssignableTo`'s own cache, and cleared by
 *    `clearJavaSymbolCaches` for the same reason.
 *
 * A `Map<K,V>`/raw `Map` unwraps to `java.util.Map.Entry<K,V>`/`java.util.Map.Entry` -- both
 * Supermodel's and JSTL's forEach (`sm:forEach`/`c:forEach`, both `elBindingTags`-configured with
 * `iterates: true`) follow the same `LoopTagSupport`-based JSTL behavior: handed a `Map`, they
 * iterate its `entrySet()`, one `Map.Entry` per loop, not the bare values -- confirmed against this
 * codebase's own real usage (`searchresults.jsp`'s `<sm:forEach name="searchFilterOptions"
 * var="_option">` then reads `_option.key`/`_option.value...`, exactly `Map.Entry`'s own `getKey()`/
 * `getValue()` accessor names via the usual JavaBean-getter EL convention -- not the `Map`-shaped
 * bare-property-access shortcut `resolveChainHop` has for a *non-iterated* `Map`, which would
 * otherwise (wrongly) read `.key` as `map.get("key")`).
 *
 * Returns `undefined` -- never a guess -- both for a shape none of the three tiers above recognize at
 * all, *and* for one that some tier does recognize (it really is `Iterable`/`Map`-shaped) but whose
 * element type doesn't itself resolve to a real class -- most commonly a generic type variable with
 * nothing concrete bound to it anywhere this extension can see. That matters for tier 2 just as much
 * as tier 3: `directIterableElementType`/`directMapEntryType` read their candidate straight out of
 * whatever raw, possibly-unsubstituted source text `resolveMemberReturnType` handed them (e.g. a
 * `Paginator<T>.getPage()` whose `T` a hierarchy walk failed to bind all the way down to a concrete
 * class -- an inherited member several jar-boundary hops up a generic hierarchy is exactly where that
 * substitution is most likely to fall short), so a residual type-variable name (e.g. `"T"`) is just as
 * reachable there as at tier 3, not a tier-3-only concern. Without `isValidElementType`'s check, that
 * name would get set as the loop variable's "resolved" type, and every later property access on it
 * would then silently pass through `resolveMemberReturnType`'s own `status: 'unknown'` --
 * indistinguishable from "checked, and fine" to every one of its callers -- rather than surfacing the
 * same `unresolvedIterationDiagnostic` a fully-unrecognized shape already gets. Abstaining here, so
 * that diagnostic still fires, keeps this a strictly additive improvement over the old allowlist: any
 * case that couldn't already resolve stays exactly as visibly unresolved as it was before.
 */
/**
 * Confirms a candidate element type -- from either tier 2 (`directIterableElementType`/
 * `directMapEntryType`) or tier 3 (`resolveIterationElementTypeViaHierarchy`) -- resolves to (a)
 * real class(es) before `resolveIterationElementType` trusts it as a loop variable's type. The one
 * shared implementation of that check, called from both tiers' own return points, rather than each
 * tier separately deciding whether/how to validate its own candidate -- which is exactly how this
 * function came to exist: tier 3 originally had this check inline and tier 2 didn't have it at all,
 * so a `List<T>` whose `T` a generic-substitution walk failed to bind reached tier 2's fast path and
 * came back as the literal, unresolved type variable `"T"` instead of the abstain this was always
 * meant to produce. `java.util.Map.Entry<K,V>` validates `K`/`V` individually -- `java.util.Map.Entry`
 * itself is a fixed JDK class, always real, so `resolveClass` on the whole candidate string would
 * trivially pass even with a bogus `K`/`V` (it strips generics before resolving, same as everywhere
 * else in this file) -- everything else validates as the single class it already is.
 */
async function isValidElementType(candidate) {
    const entryArgs = candidate.startsWith('java.util.Map.Entry<') ? parseTypeArgs(candidate) : undefined;
    if (entryArgs) {
        const locations = await Promise.all(entryArgs.map((arg) => resolveClass(arg)));
        return locations.every(Boolean);
    }
    return Boolean(await resolveClass(candidate));
}
async function resolveIterationElementType(type) {
    const arrayElement = ARRAY_ELEMENT_TYPE.exec(type)?.[1];
    if (arrayElement) {
        return arrayElement;
    }
    const direct = directIterableElementType(type) ?? directMapEntryType(type);
    if (direct) {
        return (await isValidElementType(direct)) ? direct : undefined;
    }
    const cached = iterationElementTypeCache.get(type);
    if (cached) {
        return cached;
    }
    const result = resolveIterationElementTypeViaHierarchy(type);
    iterationElementTypeCache.set(type, result);
    // Same "don't cache abstaining" rule as `isAssignableTo`/`resolveMemberReturnType` -- a transient
    // `undefined` (jdtls not ready, or the walk itself failed) shouldn't stick around and block a retry
    // once the workspace catches up; only a confidently-exhausted walk should.
    result.then((resolved) => {
        if (resolved === undefined) {
            iterationElementTypeCache.delete(type);
        }
    });
    return result;
}
/**
 * Walks `type`'s own supertype hierarchy (`walkSupertypes`) looking for the point it reaches
 * `java.lang.Iterable` or `java.util.Map`, and reads off that interface's own type argument(s) --
 * `resolveIterationElementType`'s tier-3 fallback, for a class not on `COLLECTION_FAMILY_NAMES`/
 * `MAP_FAMILY_NAMES`'s fixed lists. The substitution accumulated by the time the walk reaches that
 * interface (see `walkSupertypes`'s own doc on the generic-substitution machinery it threads through
 * every hop, seeded here via `resolveClassHierarchyContext`'s own `rootSubstitution` the same way
 * `resolveMemberReturnTypeUncached` seeds it for a direct member) is keyed by *that interface's own*
 * declared parameter name(s) -- `Iterable<E>` has exactly one, `Map<K,V>` exactly two, in declaration
 * order -- so simply reading `substitution`'s values off in insertion order, with no need to know
 * their literal names, gives the resolved argument(s) this hop was reached with.
 */
async function resolveIterationElementTypeViaHierarchy(type) {
    const context = await resolveClassHierarchyContext(type);
    if (!context) {
        return undefined;
    }
    try {
        const found = await walkSupertypes(context.classLocation.uri, context.position, async (supertype, substitution) => {
            if (await hierarchyItemIsFqcn(supertype, 'java.lang.Iterable')) {
                return { kind: 'iterable', values: [...substitution.values()] };
            }
            if (await hierarchyItemIsFqcn(supertype, 'java.util.Map')) {
                return { kind: 'map', values: [...substitution.values()] };
            }
            return undefined;
        }, context.rootSubstitution);
        if (!found) {
            return undefined;
        }
        if (found.kind === 'iterable') {
            const candidate = stripWildcard(found.values[0] ?? 'java.lang.Object');
            return (await isValidElementType(candidate)) ? candidate : undefined;
        }
        if (found.values.length !== 2) {
            // A raw `implements Map` reference reached partway up the chain -- same JLS-erasure fact as
            // `directMapEntryType`'s own raw-`Map` case, not a guess -- no `isValidElementType` check
            // needed, same reasoning as that sibling case (see its own doc).
            return 'java.util.Map.Entry';
        }
        const candidate = `java.util.Map.Entry<${stripWildcard(found.values[0])},${stripWildcard(found.values[1])}>`;
        return (await isValidElementType(candidate)) ? candidate : undefined;
    }
    catch (error) {
        console.error('[vscode-jsp-linker] resolveIterationElementType failed:', error);
        return undefined;
    }
}
/**
 * Unwraps a `Map<K,V>`-shaped type's value type `V` (e.g. `"Map<String,String>"` -> `"String"`,
 * `"java.util.Map<java.lang.String,java.lang.String[]>"` -> `"java.lang.String[]"`), for
 * `resolveChainHop`'s key-lookup case below. Only handles a single, non-nested value type argument
 * -- every `Map`-typed EL variable this extension seeds a type for (the JSP implicit objects, see
 * `EL_IMPLICIT_OBJECT_TYPES` in `variableTypes.ts`) is shaped that way; a `Map<K, Map<K2,V2>>` isn't
 * a shape anything currently produces, so this doesn't try to handle it.
 *
 * Also handles a *raw* Map (no type arguments at all, e.g. plain `"java.util.SortedMap"` -- the
 * element type `resolveIterationElementType` unwraps `jakarta.servlet.jsp.jstl.sql.Result#getRows()`
 * -- `SortedMap[]` -- down to, since that legacy API predates generics and was never retrofitted).
 * Unlike everywhere else in this file, resolving a raw Map's value type to `java.lang.Object` isn't
 * a guess: the JLS erases an ungenerified `Map`/`SortedMap` usage to `Map<Object,Object>`, so `Object`
 * is what it actually is, not a plausible one among several. Returns `undefined` for anything else
 * (several type arguments, some other type entirely), same "don't guess" rule as
 * `resolveIterationElementType`.
 */
function unwrapMapValueType(type) {
    return MAP_VALUE_TYPE.exec(type)?.[1] ?? (RAW_MAP_TYPE.test(type) ? 'java.lang.Object' : undefined);
}
// Matches a method's return type at the end of the raw source text between
// its declaration's start and its name -- e.g. against "public
// List<Film> " (everything before "getFavouriteFilmsValidated" in "public
// List<Film> getFavouriteFilmsValidated()"), captures "List<Film>". Anchored
// to the *end* of that prefix (`$`) rather than the start, so modifiers,
// annotations, and any preceding Javadoc -- all of which can appear before
// the return type -- are skipped over rather than accidentally captured.
const RETURN_TYPE_BEFORE_NAME = /([\w.]+(?:<[^()]*>)?(?:\[\])*)\s*$/;
// Matches a plain (single-dimensional) Java array type, e.g. "java.util.SortedMap[]" ->
// "java.util.SortedMap", "String[]" -> "String". Anchored at both ends so a multi-dimensional
// array ("Object[][]") doesn't match and fall through as if it were one level unwrapped already --
// same "don't guess" rule as everywhere else in this file.
const ARRAY_ELEMENT_TYPE = /^([\w.]+)\[\]$/;
// Matches a `Map<K,V>`-shaped type's *second* type argument -- e.g. "Map<String, String[]>" ->
// "String[]". Only matches a plain (non-generic) value type, since that's the only shape this
// extension ever seeds (see `unwrapMapValueType`'s own comment above for why). Includes `SortedMap`
// alongside `Map` itself, since that's the other Map-family interface actually seen on a
// chain-resolved type here (`jakarta.servlet.jsp.jstl.sql.Result#getRows()`'s element type).
//
// Unlike `resolveIterationElementType`'s own Map-family handling (which falls back to a real
// type-hierarchy walk for anything not literally named `Map`/`SortedMap`), this stays a fixed
// allowlist: `unwrapMapValueType` backs `resolveChainHop`'s *non-iterated* bare-property/bracket
// access (`someMap.key`/`someMap["key"]`), a synchronous call site, and generalizing it the same way
// would mean making that call site (and its own callers) async for a gap no bug report has ever
// actually hit -- see `unwrapMapValueType`'s own doc for the exact same "not a guess, just narrower
// in scope than it could be" reasoning already accepted for its raw-`Map` case below.
const MAP_VALUE_TYPE = /^(?:java\.util\.)?(?:Map|SortedMap)<\s*[\w.]+\s*,\s*([\w.]+(?:\[\])*)\s*>/;
// Matches a *raw* Map-family type with no type arguments at all -- i.e. the entire type string is
// just the bare interface name. See `unwrapMapValueType`'s own comment for why a raw Map's value
// type can be confidently given as `java.lang.Object` rather than left unresolved. Shared with
// `directMapEntryType`'s own raw-`Map` case above, which resolves to the same JLS-erasure fact for
// the iteration path instead of `unwrapMapValueType`'s non-iterated one.
const RAW_MAP_TYPE = /^(?:java\.util\.)?(?:Map|SortedMap)$/;
// Matches a record's header -- its declaration keyword through the closing
// paren of its component list, e.g. "record TicketsUrl(String widgetUrl,
// String checkUrl)" -- capturing just the component list. Doesn't handle a
// component type containing its own parens/commas (a nested generic like
// `Map<String, Integer>`, or an annotation with arguments) -- not a shape
// any record in this codebase's chain-accessed types uses; would need real
// paren-depth tracking to support that.
const RECORD_HEADER = /\brecord\s+\w+\s*\(([^()]*)\)/d;
/**
 * A Java record's accessor methods (e.g. `checkUrl()` for a `String
 * checkUrl` component) are compiler-synthesized -- there's no method body
 * in source for jdtls's document-symbol outline to report, so `findMember`
 * can never find one there regardless of `java.symbols.includeGeneratedCode`
 * (that setting is specifically about Lombok-generated code, a completely
 * different mechanism). The component list in the record's own header is
 * the only place an accessor's name and type are declared at all, so this
 * reads it directly -- called as a fallback from `resolveMemberReturnType`
 * once `findMember` comes up empty.
 */
function findRecordComponent(classText, candidateNames) {
    const header = RECORD_HEADER.exec(classText);
    const paramsRange = header?.indices?.[1];
    if (!header || !paramsRange) {
        return undefined;
    }
    let cursor = paramsRange[0];
    for (const param of header[1].split(',')) {
        const tokens = param.trim().split(/\s+/);
        const name = tokens[tokens.length - 1];
        const type = tokens.slice(0, -1).join(' ');
        const nameStart = cursor + param.lastIndexOf(name);
        if (type && candidateNames.includes(name)) {
            return { type, nameRange: [nameStart, nameStart + name.length] };
        }
        cursor += param.length + 1; // +1 to skip the ","
    }
    return undefined;
}
// jdtls reports a generic type's own DocumentSymbol.name with its type parameter list attached
// (e.g. "AbstractCQBPaginator<T, ENTITY, Q>", not bare "AbstractCQBPaginator") -- and a supertype
// hierarchy item's own `name` (see `JavaTypeHierarchyItem`) can just as easily come back with a
// *substituted* argument list instead of the declaring class's own type parameters (e.g.
// "AbstractCQBPaginator<Person, Person, Person>" for `PersonWithRolePaginator`'s own supertype).
// Neither is the bare simple name `findTypeSymbol`'s callers always search for (`fqcn`'s own last
// dot-segment, or a `JavaTypeHierarchyItem.name` passed straight through), so both sides of the
// comparison need this stripped before comparing, not just one.
function stripGenericTypeParams(name) {
    const angleIndex = name.indexOf('<');
    return angleIndex === -1 ? name : name.slice(0, angleIndex);
}
/**
 * Finds a type (class/interface/enum/record) symbol by its simple name,
 * searching recursively -- needed for a nested record like `AvailabilityBean`'s
 * `TicketsUrl`, which only shows up as a *child* of the enclosing class's own
 * symbol. See `resolveMemberReturnType`'s record fallback for why this is
 * used instead of trusting `resolveClass`'s own `Location.range`.
 */
function findTypeSymbol(symbols, simpleName) {
    for (const symbol of symbols) {
        if (TYPE_KINDS.has(symbol.kind) && stripGenericTypeParams(symbol.name) === stripGenericTypeParams(simpleName)) {
            return symbol;
        }
        if (symbol.children?.length) {
            const nested = findTypeSymbol(symbol.children, simpleName);
            if (nested) {
                return nested;
            }
        }
    }
    return undefined;
}
// Both `Field` and `Constant` are included since it isn't verified which one jdtls actually reports
// for a `public static final` field -- `Constant` is the LSP's own dedicated kind for a compile-time
// constant, but jdtls may just as plausibly report it as an ordinary `Field` with no distinction from
// an instance one; matching both is the safe "don't guess which, cover both" choice, not a claim
// either has actually been observed here. `EnumMember` is included for the same underlying reason a
// bare enum constant (`AuthScope.LOW`, no method call) needs to resolve the same way a field does --
// EL itself draws no distinction (`StaticFieldELResolver` reads any accessible static field, an enum
// constant included).
const FIELD_KINDS = new Set([vscode.SymbolKind.Field, vscode.SymbolKind.Constant, vscode.SymbolKind.EnumMember]);
function findMember(symbols, memberName, kind = 'method') {
    for (const symbol of symbols) {
        // jdtls reports method symbol names as "methodName(ParamType, ...)" --
        // we don't disambiguate overloads, landing on any overload is good enough for v1.
        const isMatch = kind === 'method' ? symbol.kind === vscode.SymbolKind.Method && symbol.name.startsWith(`${memberName}(`) : FIELD_KINDS.has(symbol.kind) && symbol.name === memberName;
        if (isMatch) {
            return symbol;
        }
        if (symbol.children?.length && !TYPE_KINDS.has(symbol.kind)) {
            const nested = findMember(symbol.children, memberName, kind);
            if (nested) {
                return nested;
            }
        }
    }
    return undefined;
}
/** Like `findMember`, but collects every overload instead of returning the first hit -- needed by
 * `resolveMethodOverloads` below, which (unlike everywhere else in this file) does need to
 * consider every overload's own signature, not just whichever one jdtls's outline happens to
 * report first. */
function findAllMembers(symbols, memberName) {
    const matches = [];
    for (const symbol of symbols) {
        if (symbol.kind === vscode.SymbolKind.Method && symbol.name.startsWith(`${memberName}(`)) {
            matches.push(symbol);
        }
        if (symbol.children?.length && !TYPE_KINDS.has(symbol.kind)) {
            matches.push(...findAllMembers(symbol.children, memberName));
        }
    }
    return matches;
}
// Strips one leading annotation (e.g. "@NonNull", "@SuppressWarnings(\"foo\")" -- non-nested parens
// only, same limitation as everywhere else in this file that doesn't attempt real Java parsing) or
// the "final" modifier off a parameter declaration, so `parseParamType` below can be applied
// repeatedly until neither matches.
const LEADING_ANNOTATION_OR_MODIFIER = /^(?:@\w+(?:\([^()]*\))?|final)\s+/;
/**
 * Extracts just the type from one raw "Type name" parameter declaration (annotations/"final"
 * already allowed for by `LEADING_ANNOTATION_OR_MODIFIER` above), e.g. "java.util.List<Film> films"
 * -> "java.util.List<Film>". Splits on the *last* whitespace run rather than the first, so a
 * generic type argument's own internal spaces (e.g. "Map<String, Integer> counts") don't confuse
 * which token is the parameter's name. Returns `undefined` -- abstain, don't guess wrong -- when no
 * separate name token is found at all, or the name ends in "[]" (the legal but rare C-style array
 * declaration, e.g. "String args[]", whose brackets belong to the type but aren't captured there).
 */
function parseParamType(rawParam) {
    let text = rawParam.trim();
    let stripped;
    while ((stripped = text.replace(LEADING_ANNOTATION_OR_MODIFIER, '')) !== text) {
        text = stripped.trim();
    }
    const lastSpace = text.lastIndexOf(' ');
    if (lastSpace === -1) {
        return undefined;
    }
    const type = text.slice(0, lastSpace).trim();
    const name = text.slice(lastSpace + 1).trim();
    return type && name && !name.endsWith(']') ? type : undefined;
}
/**
 * Extracts a method's declared parameter types, in order, from the source text between its name
 * and its declaration's matching close paren -- e.g. "(java.lang.String name, int count)" ->
 * ["java.lang.String", "int"]. Parallel to `extractMemberReturnType` above, which reads the text
 * *before* the name for the return type; this reads the text *after* it instead, then splits it via
 * `splitParamTypes` (tldParsing.ts -- the same `<>`-depth-aware top-level-comma splitter a TLD
 * `<function-signature>`'s already-bare type list uses, just followed here by `parseParamType` to
 * strip each item's trailing parameter name, which a TLD signature doesn't have).
 *
 * Returns `undefined` -- abstain on this overload entirely, rather than a best-effort partial
 * result -- when the parameter list contains varargs ("...", not a fixed arity this can validate a
 * call's argument count against) or any single parameter `parseParamType` can't confidently read.
 */
function extractMemberParamTypes(document, member) {
    const afterName = document.getText(new vscode.Range(member.selectionRange.end, member.range.end));
    const openParen = afterName.indexOf('(');
    if (openParen === -1) {
        return undefined;
    }
    let depth = 0;
    let closeParen = -1;
    for (let i = openParen; i < afterName.length; i++) {
        if (afterName[i] === '(') {
            depth++;
        }
        else if (afterName[i] === ')') {
            depth--;
            if (depth === 0) {
                closeParen = i;
                break;
            }
        }
    }
    if (closeParen === -1) {
        return undefined;
    }
    const paramList = afterName.slice(openParen + 1, closeParen).trim();
    if (!paramList) {
        return [];
    }
    if (paramList.includes('...')) {
        return undefined;
    }
    const types = [];
    for (const rawParam of (0, tldParsing_1.splitParamTypes)(paramList)) {
        const type = parseParamType(rawParam);
        if (!type) {
            return undefined;
        }
        types.push(type);
    }
    return types;
}
// Session-long cache, same reasoning and same invalidation trigger as `resolveMemberReturnType`'s
// own cache (see `clearJavaSymbolCaches`) -- a class's own overloads don't change without its .java
// source changing, so re-resolving the same (fqcn, methodName) pair on every hop of every chain in
// every re-validation is pure waste, and `resolveChainHop`'s overload selection can call this once
// per candidate arity-check on top of whatever else a hop already costs.
const methodOverloadsCache = new Map();
/**
 * Resolves every overload of `methodName` declared on `fqcn`, each with its own parameter types,
 * return type, and location -- for `resolveChainHop`'s overload-aware call resolution, which
 * (unlike `resolveMemberReturnType`/`findMember` elsewhere in this file, which land on "any"
 * overload) genuinely needs every overload's own signature to tell them apart by argument count and
 * type.
 *
 * Includes overloads inherited unchanged from a supertype (e.g. `Poster#posterURL(int, boolean)`,
 * still callable on `OptimisedPoster` even though that subclass only overrides the 3-arg overload)
 * -- the same supertype walk `resolveInheritedMember`/`isAssignableTo` already use elsewhere in this
 * file (see `collectInheritedOverloads`), except it collects a match from *every* ancestor instead
 * of stopping at the first, since a subclass overriding one overload doesn't remove its
 * different-arity siblings from the supertype -- both remain simultaneously callable.
 *
 * `'unknown'` when the class or its document symbols aren't available -- abstain, same as
 * `resolveMemberReturnType`'s own starting-type case. An overload whose parameter list
 * `extractMemberParamTypes` can't confidently parse (varargs, an unrecognized shape), or whose
 * return type `extractMemberReturnType` can't read, is simply dropped from the result rather than
 * poisoning the others -- the caller still has every *other* overload's real signature to check a
 * call against.
 *
 * Each overload's `returnType` is substituted against whatever generic instantiation it was actually
 * reached through (`rootSubstitutionFor` for one declared directly on `fqcn`, the hop's own
 * substitution from `walkSupertypes` for one inherited via `collectInheritedOverloads`) -- the same
 * substitution `resolveMemberReturnType` already applies for a property, so e.g.
 * `IOnePerPersonPaginator<T>.onePerPerson()`'s raw declared `"List<T>"` comes back as
 * `"List<ProductionList>"` for `ProductionListPaginator`, not literal, unbound `"List<T>"`.
 */
async function resolveMethodOverloads(fqcn, methodName) {
    const cacheKey = `${fqcn}#${methodName}`;
    const cached = methodOverloadsCache.get(cacheKey);
    if (cached) {
        return cached;
    }
    const result = resolveMethodOverloadsUncached(fqcn, methodName);
    methodOverloadsCache.set(cacheKey, result);
    // Same "don't cache abstaining" rule as `resolveMemberReturnType` -- a transient 'unknown' (jdtls
    // not ready yet) shouldn't stick around and block a retry once it is.
    result.then((resolved) => {
        if (resolved === 'unknown') {
            methodOverloadsCache.delete(cacheKey);
        }
    });
    return result;
}
async function toOverloadInfo(document, uri, member) {
    const paramTypes = extractMemberParamTypes(document, member);
    if (!paramTypes) {
        return undefined;
    }
    // `paramTypes` (via `extractMemberParamTypes`) stays unqualified -- overload *selection* only
    // needs each candidate's own arity/parameter types to pick the right one (see `isAssignableTo`'s
    // own comment on bare primitive/simple-name text being an expected input there), never feeding a
    // further chain hop the way a return type does. `returnType` does feed one, though -- it becomes
    // `resolveOverloadedCall`'s own `GetterLookupResult.type`, exactly like
    // `findMemberOrRecordComponent`'s -- so it needs the same `qualifyReturnType` treatment, or a
    // chain-ending method call (e.g. `${x.getPartnerAccount().getStoryPaginator()}`) would hit the
    // identical bare-simple-name ambiguity one hop later.
    const returnTypeSpan = extractMemberReturnType(document, member);
    const returnType = returnTypeSpan ? await qualifyReturnType(document, uri, returnTypeSpan) : undefined;
    return returnType ? { paramTypes, returnType, location: new vscode.Location(uri, member.selectionRange) } : undefined;
}
/**
 * `toOverloadInfo` for every `methodName` overload declared directly on one ancestor visited while
 * walking a type's supertype hierarchy (see `collectInheritedOverloads`) -- `undefined` (keep
 * walking, don't abort the whole search) when this ancestor's document symbols aren't available,
 * same "a different branch, or the file just not being open/indexed yet, shouldn't abort the whole
 * search" reasoning as `findMemberOnSupertype`.
 *
 * `substitution` -- this hop's own type-variable substitution map, as `walkSupertypes` computes and
 * hands to every visitor (see its own doc) -- is applied to each overload's `returnType` *and* each of
 * its `paramTypes`, exactly the way `findMemberOnSupertype` applies it to a property's return type, via
 * the same `substituteTypeVariables` call: e.g. `AnythingList<TListable, TListEntry>.entryFor(TListable
 * listable)`'s raw declared `"TListable"` parameter comes back as `"AbstractProduction<?>"` for a walk
 * that reached it via `ProductionList`, not `TListable` left unbound. `paramTypes` needs this as much as
 * `returnType` does, for two reasons: `collectInheritedOverloads`'s own dedup key is built from
 * `paramTypes` text, so an inherited generic overload a subclass already overrides concretely (e.g.
 * `ProductionList`'s own `entryFor(AbstractProduction<?>)`) would otherwise never match that override's
 * key and survive as a spurious extra candidate; and `resolveOverloadedCall`'s own
 * `checkArgumentCompatibility` pass can never confirm a real argument against a bare, unresolvable
 * type-variable name like `"TListable"` (`resolveClass("TListable")` finds no such class), so it always
 * abstains rather than ruling that phantom candidate out -- both compounding into an overload that looks
 * ambiguous when there's really just one legitimate match. Before this, a method call resolved through
 * this walk silently disagreed with a property access resolved through `resolveInheritedMember`'s own
 * identical walk, which already substituted its return type -- both now call the exact same
 * `substituteTypeVariables(text, substitution)` primitive on the hop's own `substitution`, so there's no
 * second place this could drift out of sync again.
 */
async function findAllOverloadsOnSupertype(uri, simpleName, methodName, substitution) {
    const outline = await openTypeOutline(uri, simpleName);
    if (!outline) {
        return undefined;
    }
    const overloads = [];
    for (const member of findAllMembers(outline.typeSymbol?.children ?? outline.docSymbols, methodName)) {
        const overload = await toOverloadInfo(outline.document, uri, member);
        if (overload) {
            overloads.push({
                ...overload,
                paramTypes: overload.paramTypes.map((paramType) => substituteTypeVariables(paramType, substitution)),
                returnType: substituteTypeVariables(overload.returnType, substitution),
            });
        }
    }
    return overloads;
}
/**
 * A `paramTypes` dedup key for `collectInheritedOverloads`' `seen` set, comparing by each parameter's
 * bare simple name (`splitFqcn`'s own `simpleName` -- the same split `resolveClass`'s single-candidate
 * fallback already uses, not a second copy of that logic) rather than its raw text. The two sides being
 * compared are never guaranteed to share one text form: `ownOverloads`' own direct paramTypes stay
 * deliberately unqualified (e.g. `"AbstractProduction<?>"`, see `toOverloadInfo`'s own comment on why),
 * while an inherited overload's paramTypes -- since `findAllOverloadsOnSupertype` now substitutes them
 * the same way it already did `returnType` -- come back through `resolveHopSubstitution`'s own
 * `qualifyBareIdentifiersIn` call, which always produces a fully-qualified FQCN (e.g.
 * `"com.letterboxd.om.AbstractProduction<?>"`). A raw string comparison between those two forms of the
 * exact same type never matches, so a subclass's own concrete override of a generic superclass method
 * (e.g. `ProductionList.entryFor(AbstractProduction<?>)` overriding `AnythingList<TListable,
 * ...>.entryFor(TListable)`) would still survive as a second, spurious candidate even once the type
 * variable itself resolves correctly -- just a *resolvable* one now, not an inert `"TListable"`.
 */
function paramTypesDedupKey(paramTypes) {
    return paramTypes.map((paramType) => splitFqcn(paramType).simpleName).join(',');
}
/**
 * Walks `fqcn`'s supertype hierarchy (`walkSupertypes`) collecting every `methodName` overload not
 * already covered by `ownOverloads`' own signatures -- unlike `resolveInheritedMember`'s visitor,
 * this one always returns `undefined` so the walk never stops early: a subclass overriding one
 * overload doesn't remove its different-arity siblings from the supertype, so every ancestor needs
 * checking, not just the first with a match. Errors (an unexpected jdtls type-hierarchy response
 * shape) are swallowed, same as `resolveInheritedMember`'s own reasoning -- letting one propagate
 * would abort the whole calling `ElDiagnostics.validate()` loop rather than just leaving inherited
 * overloads undiscovered for this one call.
 *
 * Reads the hop's own `substitution` off `walkSupertypes`' visitor callback (the same one
 * `resolveInheritedMember`'s visitor reads) and threads it into `findAllOverloadsOnSupertype`, so an
 * overload found several hops up a generic hierarchy comes back with its return type substituted
 * against *this* concrete instantiation, not left as the raw, unbound type-variable text its
 * declaring interface/class actually spells it with.
 */
async function collectInheritedOverloads(anchorUri, anchorPosition, methodName, ownOverloads, 
// The substitution already in effect for `fqcn` itself (see `walkSupertypes`' own `rootSubstitution`
// param) -- required, not defaulted, for the same reason `resolveInheritedMember`'s own param is:
// this function's one caller (`resolveMethodOverloadsUncached`) already computes a real one for its
// *direct* overloads a few lines above this call, so there's no case where passing anything but that
// same value here would be correct. Before this was threaded through, an inherited overload's return
// type came back in terms of the *declaring* supertype's own raw type variables (e.g. `T` from
// `Paginator<T>.getPage()`) rather than substituted against the concrete instantiation the walk
// actually started from -- the exact same gap `resolveInheritedMember` had for a property getter.
rootSubstitution) {
    const seen = new Set(ownOverloads.map((overload) => paramTypesDedupKey(overload.paramTypes)));
    try {
        await walkSupertypes(anchorUri, anchorPosition, async (supertype, substitution) => {
            const inherited = await findAllOverloadsOnSupertype(vscode.Uri.parse(supertype.uri), supertype.name, methodName, substitution);
            for (const overload of inherited ?? []) {
                const key = paramTypesDedupKey(overload.paramTypes);
                if (!seen.has(key)) {
                    seen.add(key);
                    ownOverloads.push(overload);
                }
            }
            return undefined;
        }, rootSubstitution);
    }
    catch (error) {
        console.error(`[vscode-jsp-linker] collectInheritedOverloads(${methodName}) failed:`, error);
    }
}
async function resolveMethodOverloadsUncached(fqcn, methodName) {
    const context = await resolveClassHierarchyContext(fqcn);
    // `context.outline` specifically -- see `resolveMemberReturnTypeUncached`'s own identical check, and
    // `resolveClassHierarchyContext`'s own doc, for why this (not just a missing `context`) is this
    // function's own abstain case: there's nothing to search for *direct* overloads without it, even
    // though `collectInheritedOverloads` below could still attempt a walk with just `context.position`.
    if (!context || !context.outline) {
        return 'unknown';
    }
    const { classLocation, rootSubstitution } = context;
    const { document: classDocument, docSymbols, typeSymbol } = context.outline;
    const candidates = findAllMembers(typeSymbol?.children ?? docSymbols, methodName);
    const overloads = [];
    for (const member of candidates) {
        const overload = await toOverloadInfo(classDocument, classLocation.uri, member);
        if (overload) {
            // Same root-instantiation gap `resolveMemberReturnTypeUncached` closes for a direct property --
            // `fqcn` can itself already be a concrete generic instantiation, whose direct method overloads
            // (read straight from source) come back in terms of *its own* declared type parameters until
            // `context.rootSubstitution` is applied.
            overloads.push({ ...overload, returnType: substituteTypeVariables(overload.returnType, rootSubstitution) });
        }
    }
    await collectInheritedOverloads(classLocation.uri, context.position, methodName, overloads, rootSubstitution);
    return overloads;
}
/**
 * Resolves every distinct FQCN in the given list (duplicates resolved only
 * once) to whether it exists, via `resolveClass` -- `true`/`false` for a
 * confident answer either way, `undefined` when this couldn't be determined
 * (the language server isn't ready, or the lookup itself threw). Callers that
 * turn this into a persistent "broken reference" diagnostic must treat
 * `undefined` the same as `true` (don't flag) -- collapsing it into `false`
 * would report every reference in a file as broken the moment the server
 * isn't ready, not just the ones that actually are. Bails out before
 * querying jdtls at all when the server isn't ready: every fqcn would get the
 * same `undefined` answer regardless of the individual class, so there's no
 * point paying for `uniqueFqcns.length` round trips to learn that n times over.
 */
async function resolveClasses(fqcns) {
    const uniqueFqcns = [...new Set(fqcns)];
    const resolutions = new Map();
    if (!javaExtensionGateway_1.javaExtensionGateway.isReady()) {
        for (const fqcn of uniqueFqcns) {
            resolutions.set(fqcn, undefined);
        }
        return resolutions;
    }
    await Promise.all(uniqueFqcns.map(async (fqcn) => {
        try {
            resolutions.set(fqcn, (await resolveClass(fqcn)) !== undefined);
        }
        catch (error) {
            console.error(`[vscode-jsp-linker] resolveClass("${fqcn}") failed:`, error);
            resolutions.set(fqcn, undefined);
        }
    }));
    return resolutions;
}
// isJavaExtensionActive/isJavaServerReady/trackJavaServerReadiness/onJavaClasspathUpdate moved to
// javaExtensionGateway.ts, alongside the executeCommand calls below -- see that file's own comment.
//# sourceMappingURL=javaSymbols.js.map