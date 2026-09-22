"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.DIRECTIVES = void 0;
const BOOLEAN = ['true', 'false'];
/**
 * Every directive defined by the Jakarta Server Pages spec (section 1.10),
 * with each one's valid attributes -- used by `DirectiveHoverProvider` (show
 * a directive's own description and full attribute list on hovering its
 * name, or one attribute's description on hovering it) and
 * `DirectiveAttributeCompletionProvider` (suggest attribute names, and for
 * `values`-constrained ones, their valid literal values). `page`, `include`,
 * and `taglib` are valid in `.jsp`/`.jspf` files; `tag`, `attribute`, and
 * `variable` are valid only in `.tag` files -- this table doesn't enforce
 * that distinction, since a directive used in the wrong file kind is
 * something jasper itself will reject at translation time, not something
 * worth a second diagnostic here.
 */
exports.DIRECTIVES = {
    page: {
        name: 'page',
        description: 'Defines page-dependent attributes and communicates them to the container.',
        attributes: [
            { name: 'import', description: "Comma-separated list of Java types/packages to import, e.g. \"java.util.*\"." },
            { name: 'contentType', description: 'MIME type (and optional charset) of the response.' },
            { name: 'pageEncoding', description: 'Character encoding of the JSP source file.' },
            { name: 'session', description: 'Whether this page participates in an HTTP session.', values: BOOLEAN },
            { name: 'buffer', description: 'Output buffer size for the response, e.g. "8kb", or "none".' },
            { name: 'autoFlush', description: 'Whether the output buffer is flushed automatically when it fills.', values: BOOLEAN },
            { name: 'isThreadSafe', description: 'Whether the generated servlet can handle concurrent requests.', values: BOOLEAN },
            { name: 'info', description: 'Descriptive text for the page, retrievable via Servlet#getServletInfo().' },
            { name: 'errorPage', description: 'Relative URL of the page to forward to on an uncaught exception.' },
            {
                name: 'isErrorPage',
                description: 'Whether this page is itself an error page, exposing the implicit "exception" object.',
                values: BOOLEAN,
            },
            { name: 'language', description: 'Scripting language used for scriptlets/expressions (always "java").' },
            { name: 'extends', description: 'Superclass the generated servlet extends. Rarely used -- constrains the container.' },
            { name: 'isELIgnored', description: 'Whether EL expressions ("${...}") are evaluated, or emitted as literal text.', values: BOOLEAN },
            {
                name: 'deferredSyntaxAllowedAsLiteral',
                description: 'Whether "#{" may appear as literal text without being escaped.',
                values: BOOLEAN,
            },
            {
                name: 'trimDirectiveWhitespaces',
                description: 'Whether template whitespace surrounding directives is trimmed from the output.',
                values: BOOLEAN,
            },
            {
                name: 'isScriptingEnabled',
                description: 'Whether scripting elements (scriptlets, expressions, declarations) are permitted on this page.',
                values: BOOLEAN,
            },
        ],
    },
    include: {
        name: 'include',
        description: 'Includes the content of another file at translation time (static include).',
        attributes: [
            {
                name: 'file',
                description: 'Path of the file to include -- webapp-root-relative with a leading "/", otherwise relative to this file.',
                required: true,
            },
        ],
    },
    taglib: {
        name: 'taglib',
        description: "Declares this page uses a custom tag library, bound to a prefix (e.g. \"sm\" in <sm:url>).",
        attributes: [
            { name: 'uri', description: "The tag library's declared URI, or a direct webapp-relative path to its .tld." },
            {
                name: 'tagdir',
                description: 'Webapp-relative directory of .tag files backing this taglib, e.g. "/WEB-INF/tags/mytags".',
            },
            { name: 'prefix', description: 'The prefix used to reference this taglib\'s tags/functions.', required: true },
        ],
    },
    tag: {
        name: 'tag',
        description: "A .tag file's own equivalent of the page directive -- defines attributes of the tag file as a whole.",
        attributes: [
            { name: 'display-name', description: 'Short name for this tag, intended for display by tools.' },
            {
                name: 'body-content',
                description: 'What kind of body content this tag accepts.',
                values: ['empty', 'scriptless', 'tagdependent'],
            },
            {
                name: 'dynamic-attributes',
                description: "Name of the java.util.Map variable that collects any attribute not explicitly declared via <%@attribute%> -- makes this tag accept arbitrary attribute names.",
            },
            { name: 'small-icon', description: 'Small icon image resource, for tool display.' },
            { name: 'large-icon', description: 'Large icon image resource, for tool display.' },
            { name: 'description', description: 'Descriptive text for this tag.' },
            { name: 'example', description: 'Informal description of an example use of this tag.' },
            { name: 'language', description: 'Scripting language used for scriptlets/expressions (always "java").' },
            { name: 'import', description: "Comma-separated list of Java types/packages to import, e.g. \"java.util.*\"." },
            { name: 'pageEncoding', description: 'Character encoding of the tag file source.' },
            { name: 'isELIgnored', description: 'Whether EL expressions ("${...}") are evaluated, or emitted as literal text.', values: BOOLEAN },
            {
                name: 'trimDirectiveWhitespaces',
                description: 'Whether template whitespace surrounding directives is trimmed from the output.',
                values: BOOLEAN,
            },
        ],
    },
    attribute: {
        name: 'attribute',
        description: 'Declares one attribute this tag file accepts when called.',
        attributes: [
            { name: 'name', description: 'The attribute\'s name, as used at a call site, e.g. "name" in <my:avatar name="...">.', required: true },
            { name: 'required', description: 'Whether callers must supply this attribute.', values: BOOLEAN },
            {
                name: 'fragment',
                description: 'Whether this attribute is passed unevaluated as a JspFragment for the tag to render itself, e.g. conditionally or more than once.',
                values: BOOLEAN,
            },
            {
                name: 'rtexprvalue',
                description: "Whether the attribute's value can be a runtime expression (EL/scriptlet), not only a static literal.",
                values: BOOLEAN,
            },
            { name: 'type', description: 'The attribute\'s Java type. Defaults to java.lang.String.' },
            { name: 'description', description: 'Descriptive text for this attribute.' },
        ],
    },
    variable: {
        name: 'variable',
        description: 'Declares a scripting variable this tag file exposes to the calling page.',
        attributes: [
            { name: 'name-given', description: "The variable's fixed name." },
            {
                name: 'name-from-attribute',
                description: "Name of a String attribute of this tag whose value at the call site becomes the variable's name.",
            },
            {
                name: 'alias',
                description: 'For a fragment-scoped variable shared with the tag handler, the name to expose it under in the calling page.',
            },
            { name: 'variable-class', description: 'The variable\'s Java type. Defaults to java.lang.String.' },
            {
                name: 'declare',
                description: "Whether the variable is actually declared at this scope, vs. an ancestor tag already declaring it.",
                values: BOOLEAN,
            },
            {
                name: 'scope',
                description: 'How long the variable remains in scope relative to this tag invocation.',
                values: ['AT_BEGIN', 'AT_END', 'NESTED'],
            },
            { name: 'description', description: 'Descriptive text for this variable.' },
        ],
    },
};
//# sourceMappingURL=directiveAttributes.js.map