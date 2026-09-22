# Letterboxd JSP-Java Linker

A VSCode extension that lets you jump ("Go to Definition" / cmd/ctrl-click) from a Java
reference inside a JSP to its Java source. It requires the `redhat.java` extension
(bundled in `vscjava.vscode-java-pack`, already recommended for this repo) to be
active — Java symbol resolution is delegated to it rather than reimplemented here.

## What it links

1. **`<jsp:useBean class="com.foo.Bar">`** — cmd/ctrl-click the class name.
2. **Custom EL functions** declared in a `.tld` (e.g. `lfn:checkCapability(...)` from
   `WEB-INF/functions.tld`, or `fn:escapeXml(...)` from a `.tld` bundled inside a
   dependency jar) — cmd/ctrl-click the function name. Resolves the taglib prefix via
   the JSP's own `<%@ taglib %>` directives, falling back to any bound by a fragment
   reached through its `<%@include%>` chain (recursively, closest scope wins) — not
   special-cased to any one fragment filename; the taglib's functions are looked up
   first in a workspace `.tld`, then in any `.tld` bundled under `META-INF/` in the
   owning Maven module's runtime-classpath jars (see "Jar-bundled TLDs" below).
3. **Fully-qualified Java references inside scriptlets** (`<% %>` / `<%= %>`) — cmd/ctrl-click
   the class name. Only the class itself resolves; members called on it
   (e.g. `.getInstance()`) are not resolved in this version.
4. **`<%@include file="...">` / `<jsp:include page="...">`** — cmd/ctrl-click the path
   to jump to the included JSP/JSPF. Handles both webapp-root-relative paths
   (leading `/`, resolved against the including file's `src/main/webapp` ancestor,
   falling back to a dependency jar — see below) and file-relative paths (resolved
   against the including file's own directory).
5. **Custom tag files** (e.g. `<my:avatar>`, `<video-store:product-poster>`) —
   cmd/ctrl-click the tag name in either the opening *or* closing tag to jump to its
   `.tag` file, resolved via the `tagdir` binding for that prefix (its own
   `<%@ taglib %>` directives first, falling back to its include chain, same as type 2
   above) plus the tag name, e.g. `my:avatar` -> `<tagdir>/avatar.tag`. Only resolves
   for prefixes bound to a `tagdir`.
5b. **Custom tags backed by a `uri`-bound taglib instead of a `tagdir`** (e.g.
   `<fmt:formatNumber>`, `<c:forEach>`, `<sm:foo>`) — cmd/ctrl-click resolves the same
   way as type 5 above falls through: when the prefix isn't `tagdir`-bound, its `<tag>`
   entries are looked up in the taglib's TLD (workspace or jar-bundled — see
   "Jar-bundled TLDs" below) for a `<tag-class>` matching the tag name, then jumps to
   that Java class the same way `jsp:useBean` does. Only covers Java-class-backed
   `<tag>` entries; a taglib can also supply a tag via a `<tag-file>` entry (a packaged
   `.tag` resource), which isn't parsed and so won't resolve.

### Webapp-relative paths supplied by a dependency jar

A webapp-root-relative include or tagdir path (used by types 5 and 6 above) doesn't
have to exist as a file in this workspace to be valid: any classpath jar can ship
content under `META-INF/resources/`, which a Servlet 3.0+ container (Tomcat included)
transparently merges into the webapp root at runtime — this is how Supermodel ships
shared admin fragments/tags, e.g. `/WEB-INF/supermodel3/admin/frag/global.jspf` lives
inside `supermodel-web-admin-*.jar`, never as a workspace file.

When the plain filesystem lookup misses, this extension asks the Java extension
(`java.execute.workspaceCommand` → `java.project.getClasspaths`) for the owning Maven
module's runtime classpath, then scans those jars' `META-INF/resources/` entries (via
the `unzip` CLI — no bundled unzip library) for a match. A hit opens as a read-only
virtual document with the jar's actual content, so cmd/ctrl-click and the tag-attribute
validation below both work against it just like a real file. The per-module jar index
is built once and cached for the session (a resolved dependency's content in `~/.m2` is
immutable for a given version, so there's nothing to invalidate short of a window
reload); the first webapp-relative miss in a module pays a one-time cost to scan its
full classpath -- measured at ~180ms for the `web` module's ~370 runtime-classpath jars,
dominated by however long the Java extension itself takes to answer `getClasspaths`
(fast once its language server has finished importing the project, slower during
initial indexing). Every lookup after that first one is an in-memory map read.

If the Java extension can't resolve the module's classpath (not active, wrong project
model, etc.) or `unzip` isn't on `PATH`, this falls back to reporting a warning instead
of navigating anywhere — see "Broken link diagnostics" below.

### Jar-bundled TLDs

EL function resolution (type 2) and `uri`-bound custom tag resolution (type 6b) both
use the same runtime-classpath-jar lookup as a fallback: a tag library's `.tld` doesn't
have to be a workspace file either. JSTL's `c:`/`fmt:`/`fn:`, the Supermodel `sm:`
taglib, and any other library pulled in as a Maven dependency ship their `.tld`(s)
inside the jar itself, somewhere under `META-INF/` — auto-registered by the container
under the `<uri>` each TLD declares, with no central manifest to consult. When a taglib
prefix's `<%@ taglib uri="...">` isn't matched by any workspace `.tld`, this extension
scans the owning module's runtime-classpath jars' `META-INF/` entries (again via
`unzip`, not a bundled zip library) for a `.tld` declaring that URI, parses out both its
`<function>` and Java-class-backed `<tag>` elements the same way it does for a workspace
TLD, and resolves from there. Same per-module, session-long cache as the resource index
above — one-time scan cost on the first miss in a module, in-memory afterwards.

7. **A tag file's own `<%@attribute name="..." type="com.foo.Bar">` declaration** —
   cmd/ctrl-click the `type` value to jump to that Java class.
8. **A `.tag`/`.jsp` file's Jasper-generated Java and/or class file** — a CodeLens per
   artifact that actually exists on disk (see "Generated Java / Class CodeLens"
   below): `→ Generated Java (Jasper)` and/or `→ Generated Class (Jasper)`.
9. **An EL property-chain access** (`${_favourite.film}`, `${_ppb.personProduction.authorisedViewings}`)
   on a variable whose Java type this extension can pin down — cmd/ctrl-click any segment
   to jump to the getter backing it. See "EL property-chain resolution" below.

## EL property-chain resolution

Hovering or cmd/ctrl-clicking a segment of a dotted EL expression (e.g. `film` in
`${_favourite.film}`, or `authorisedViewings` in `${_ppb.personProduction.authorisedViewings}`)
resolves it as a JavaBean getter (`getFilm()`, `getAuthorisedViewings()`, ...) on whatever
type the previous segment resolved to, walking one hop per `.`. This only works for a chain
rooted in a variable whose Java type is already known:

- A `<jsp:useBean id="X" class/type="Y">` declaration.
- A variable declared by a tag configured in the `vscode-jsp-linker.elBindingTags` setting —
  see below.

These are walked together in true document order, so whichever one comes *last* for a given
variable wins — most commonly a `useBean` declaration coming first and a tag-binding usage
later rebinding it, but it also works the other way: a `<jsp:useBean id="homepage"
type="...">` placed *after* an `<sm:set var="homepage" codeOrId="...">` that this extension
can't otherwise type gives that variable a known type from that point on, exactly the same as
if it had been declared that way from the start. Placed *before* the rebind instead, it has no
effect — the rebind still wins, same as always.

### Type-hinting a variable this extension can't otherwise type

Some variable-declaring tags aren't (and won't be) modeled by `elBindingTags` — most commonly
Supermodel's `<sm:set var="X" codeOrId="...">` (loads an entity by code/id; there's no `field`
to resolve a type from). For one of these, `<jsp:useBean>`
can be used purely to tell this extension (and hover/"go to definition") the variable's real type,
*without* changing runtime behaviour — but only if it's written correctly:

- **Always use `type="..."`, never `class="..."`, for this.** `class` tells the container to
  *construct* a new instance (via a public no-arg constructor) if nothing already exists in the
  given scope. `type` alone does the opposite: it asserts that a bean of that type already exists
  in scope, and never constructs one — if it's missing, the request fails loudly at that line
  instead of silently masking whatever should have populated it. Since the whole point here is
  "this variable is *already* set by some tag I don't model," `class` would be actively wrong: if
  the real value were ever missing (e.g. `codeOrId` found nothing), `class` would silently hand
  you an empty, freshly-constructed object instead of surfacing that failure.
- **Match `scope` to whatever actually set the variable.** A `type`-only `useBean` only looks in
  the one scope you name — get it wrong and it's the same "missing bean" failure as above, even
  though the variable genuinely exists (just in a different scope). Most Supermodel tags that set
  a variable (`sm:set`, `sm:forEach`, ...) default to **page** scope when no `scope` attribute is
  given, matching JSTL's `c:set` convention — this codebase's own `sm:set` usages only add an
  explicit `scope="request"`/`"session"`/`"application"` when they deliberately want something
  other than page scope (e.g. `<sm:set scope="request" var="cssClassCode" .../>`). So: no `scope`
  on the tag that set the variable → `scope="page"` on the `useBean`; an explicit `scope="..."`
  there → the same value on the `useBean`.
- **Place it *after* the tag that actually sets the variable.** Both for runtime correctness (a
  `type`-only `useBean` running *before* the variable exists in that scope will fail, per the
  first point above) and so this extension's own resolver picks it up — see "walked together in
  true document order" above.

```jsp
<sm:set var="homepage" codeOrId="video-store-homepage" />
<jsp:useBean id="homepage" type="com.letterboxd.wrapper.videostore.VideoStoreHomePage" scope="page" />
```

`class`/no-scope-match-required is still the right choice for the *other*, more common use of
`jsp:useBean` in this codebase: actually constructing a helper `web.bean.*` wrapper and populating
it via `jsp:setProperty` (see `person-list-entry.tag`, `justwatch.tag`) — that's a genuinely new
object, not a stand-in type declaration for one a custom tag already created.

`sm:set`/`sm:forEach`/`sm:image` aren't part of the JSP spec (they're Supermodel-specific), so
this extension doesn't hardcode them: it ships with `elBindingTags` defaulting to `[]`, and this
workspace's `.vscode/settings.json` configures the three tags this codebase actually uses:

```json
"vscode-jsp-linker.elBindingTags": [
  { "tag": "sm:set", "var": "var", "source": "name", "field": "field", "value": "value", "defaultSource": "object", "bodyType": "java.lang.String" },
  { "tag": "sm:forEach", "var": "var", "source": "name", "field": "field", "value": "items", "iterates": true, "defaultSource": "object" },
  { "tag": "sm:image", "var": "var", "source": "name", "field": "field", "defaultSource": "object" }
]
```

Each entry says: this tag's `var` attribute names a new variable. Its type is resolved, in this
order: from `value`, if the tag usage sets it, as that attribute's own EL chain (recursively, via
this same mechanism — e.g. `sm:forEach`'s `items="${object.someList}"`); otherwise from `field` (a
single, non-dotted Java property name) as a getter on `source`'s type; otherwise, if `source` alone
resolves (with no `field`), `var`'s type is just `source`'s own type directly (e.g. `<sm:set
var="X" name="Y"/>` with no `field` — Supermodel's own `Util.getPropertyAsObject` confirms a null
`field` just returns the source object unchanged, so this mirrors real tag semantics, not a
convenient approximation); otherwise, if neither `source` nor `field` is present *at all* on the
usage, a configured `bodyType` (e.g. `<sm:set var="X">...</sm:set>` with no `name`/`field`/`value`
— `SetTagBase.findValue()` reads the tag's own body text as a `String` in that case, confirmed
against Supermodel's source). `iterates: true` (for a forEach-like tag) additionally unwraps one level
of generic collection element type (`List<Film>` -> `Film`) for the declared variable, whichever of
the above resolved it.

`defaultSource` is a literal variable name (not an attribute name) to use as `source` when `field`
is present but the attribute `source` names is absent from a given usage — modeling a tag's own
implicit default for that attribute, confirmed against the actual Java source
(`SetTagBase`/`ForEachTagBase`/`ImageTagBase` in `supermodel-trio`): all three hardcode
`name = "object"` in `init()`, consulted only when `field` (or `name`) was actually supplied, never
when *both* are omitted (`sm:set` uses its tag body text in that case instead — a real,
intentional exception, not an oversight). So `<sm:set var="X" field="Y"/>` or `<sm:forEach
field="Y" var="X">`, with no explicit `name=` at all, now resolve `X`'s type from `object`'s own
type wherever `object` itself is typed in that file (typically via a `<jsp:useBean id="object"
type="..."/>` — see "Type-hinting a variable" above) — this used to be silently unresolved.

A tag whose variable's type is named directly by one of its own attributes, rather than derived
from another variable's property, is configured with `classAttribute` instead of `source`/`field` —
e.g. Supermodel's `sm:ancestor`, which walks the SBean reference graph for the nearest ancestor bean
of the class named in `classCodes`:

```json
{ "tag": "sm:ancestor", "var": "var", "classAttribute": "classCodes" }
```

`<sm:ancestor var="template" classCodes="AbstractEmailTemplate" />` now resolves `template`'s type to
`AbstractEmailTemplate` directly from that attribute — no `resolveClass` lookup that's specific to
this field: whatever string lands in the `types` map here is resolved the same way any other type
name already is, the next time hover/"go to definition"/a further chain hop actually needs it, via
`resolveClass`'s existing single-unique-candidate fallback (see that function's own comment in
`javaSymbols.ts`) — a Supermodel class code like
`AbstractEmailTemplate` isn't a real, package-qualified Java FQCN (it's schema-only, generated by
Supermodel's own codegen), but it's the sole workspace symbol with that simple name, so the existing
fallback resolves it correctly with no extra logic. A `classCodes`-style attribute naming more than
one class (comma/space-separated) only uses the first.

Hovering/cmd-clicking the *base* variable of a chain -- e.g. `_viewings` in
`${_viewings.latestViewing}`, with the cursor before the first `.` -- shows/links its own known
type directly (no getter involved, since nothing's being accessed on it yet), the same as any
other segment further along the chain. This also covers a variable referenced completely bare,
with no property access at all -- e.g. `_reviewCount` in `${_reviewCount eq 1}`.

A chain's *last* segment can also be an explicit method call -- `getUid` in `${_viewing.getUid()}`,
or `authorised` in `${_viewing.authorised(authorisation)}` -- resolved by its literal Java method
name rather than the `get${Cap}`/`is${Cap}` convention (overloads aren't disambiguated by argument
count or type, same shortcut "go to definition" already takes elsewhere in this extension). A call
can only be the chain's last segment -- further property access *after* a call (e.g.
`${a.foo(x).bar}`) isn't supported, since nothing in this codebase does that (a call's result gets
bound to a new `sm:set` variable instead, then accessed separately). An identifier inside the
call's own argument list (`authorisation` above) is still independently hoverable/clickable on its
own, same as before call support existed -- it just isn't itself part of the outer chain.

A method call resolves against a Java `record`'s accessors too -- `checkUrl` in
`${_ticketsUrl.checkUrl()}`, where `TicketsUrl` is `public record TicketsUrl(String widgetUrl,
String checkUrl)`. A record's accessors are compiler-synthesized (no method body in source), so
jdtls's document-symbol outline never reports them -- unlike a Lombok-generated method, this isn't
something `java.symbols.includeGeneratedCode` affects either, since it's a completely different
mechanism. Falls back to reading the record's own component list straight out of its header in
source when the usual document-symbol lookup comes up empty (see `findRecordComponent` in
`javaSymbols.ts`) -- doesn't handle a component type containing its own parens or commas (e.g. a
nested generic like `Map<String, Integer>`), a shape no record accessed via a chain in this
codebase currently has.

A Lombok-generated accessor (e.g. `getPerson()` for a class-level `@Getter`-annotated `private
Person person;`) needs its own fallback too, for a different reason than a record's: with
`java.symbols.includeGeneratedCode` enabled, jdtls's document-symbol outline *does* report it (so
`findMember` finds it, unlike a record accessor), but its `DocumentSymbol.range` and
`.selectionRange` come back identical -- a zero-width span over the *field's* name (`person`) it
was generated from, not any real method declaration text. There's nothing between them to read a
"modifiers + return type" prefix out of (confirmed by inspection: both were reported as the exact
same `[line, character]` pair). Falls back to that field's own declaration *line*, read up to that
same position instead -- "private Person " before "person" -- which is exactly the accessor's
return/parameter type for a JavaBean-style Lombok `@Getter`/`@Setter`, by construction. See
`extractMemberReturnType` in `javaSymbols.ts`, shared by both the direct (declared-on-this-type)
and inherited (see below) lookup paths, since the same collapsed-range shape affects either one.

A property or method call also resolves when it's only declared on a *supertype* -- `getUid` in
`${_viewing.getUid()}` above is actually a `default` method on `IBoxdItEntity`, reached from
`IViewingable` (the interface `_viewing`'s chain starts from) only via
`IPostered extends IBoxdItEntity`, two hops up. Once a direct lookup on the type itself comes up
empty (no matching method, and it's not a record component either), this walks the type hierarchy
breadth-first, checking each supertype in turn before going further up. Deliberately delegated to
jdtls rather than parsed out of `extends`/`implements` clauses in source: Java's heritage syntax
(generic bounds, `sealed ... permits`, multiple-interface lists) is exactly the kind of thing this
extension leaves to real Java tooling everywhere else (see this README's opening paragraph).

The delegation itself doesn't go through VS Code's generic `vscode.prepareTypeHierarchy`/
`vscode.provideSupertypes` built-in commands -- in practice redhat.java doesn't register a
`TypeHierarchyProvider` for those (confirmed empirically: they came back unregistered even though
the extension's own "Show Type Hierarchy" view works fine), so those commands would just throw.
Instead this talks directly to the two custom `java.execute.workspaceCommand` commands
(`java.navigate.openTypeHierarchy` / `java.navigate.resolveTypeHierarchy`) that back that view
internally -- the same delegation mechanism (`java.execute.workspaceCommand`) already used
elsewhere in this extension for `java.project.getClasspaths` (see "Webapp-relative paths supplied
by a dependency jar" above), just a different inner command. Traced out of redhat.java's own
bundled `dist/extension.js` since there's no public documentation for this protocol -- being
undocumented, it's a private implementation detail of that extension rather than a stable API, and
could change shape across its versions without notice. Every call is wrapped in a try/catch that
degrades to an "unknown, couldn't check" result instead of a false "missing" if that ever happens.
See `resolveInheritedMember` (and the `JavaTypeHierarchyItem` comment above it) in
`javaSymbols.ts`.

`resolveMemberReturnType` (the one member-resolution primitive behind a getter lookup
-- `resolveMemberReturnType(fqcn, getterCandidateNames(propertyName))` -- a setter lookup, and a
literal method-name lookup alike -- i.e. every property/method-call hop of a chain) caches its
result for the session, keyed by `(fqcn, candidateNames)`. Before this walk existed, one un-cached lookup was
cheap enough not to matter; once a chain needs to walk up the hierarchy, it costs several jdtls
round trips (`openJavaTypeHierarchyRoot`, one `resolveJavaSupertypes` per hop,
`executeDocumentSymbolProvider`/`openTextDocument` per supertype visited), and re-paying that on
every debounced re-validation of a JSP that references the same Java member -- most edits don't
touch the Java side at all -- was a real, noticeable slowdown. A `'found'`/`'missing'` result is
cached indefinitely for the session (a class's own members don't change without its `.java` source
changing); an `'unknown'` result is deliberately *not* kept, since it can mean "jdtls wasn't ready
yet" -- a transient condition, not a fact about the class -- and caching it would mean it never
gets retried even once jdtls actually finishes indexing. The cache is cleared (and every open
document revalidated) whenever any `.java` file changes, via a workspace-wide file watcher in
`extension.ts` -- the same "can't cheaply know which cache entries a specific file could have
affected, so just clear everything" tradeoff `tldWatcher` already makes for a `.tld` change
(a `.jsp`/`.jspf` change is cheaper to react to -- see `TldIndex.clearFragmentBindingsCache`).

Deliberately **not** covered: a tag usage that supplies `field` without `source`, for a tag with no
`defaultSource` configured for that gap. There's no static type recoverable from JSP source for
that — nothing says which variable `field` should be read off. A usage that supplies *neither*
`source` nor `field` at all (nor `value`) is a separate case, now covered for a tag with a
configured `bodyType` — for Supermodel's own `sm:set`, that's exactly when `SetTagBase.findValue()`
reads its tag body text as a `String` at runtime, so `<sm:set var="X">...</sm:set>` with no
`name`/`field`/`value` resolves `X` to `java.lang.String` (see `bodyType` above) rather than
guessing `object`, which would be actively wrong there. `${_favourite.film}` in `<sm:forEach
field="favouriteFilmsValidated" var="_favourite">` (no explicit `name=`) is covered too, now that
`defaultSource: "object"` is configured for `sm:forEach` — `_favourite`'s type resolves from
`object`'s own type, same as if `name="object"` had been written explicitly (see "Known
limitations" below for when `object` itself isn't typed, which is the more common remaining reason
a chain like this stays unresolved).

## Tag attribute validation

For custom tags backed by a `.tag` file (see link type 6 above), the extension flags
attribute names used at a call site that the tag file doesn't declare, and separately
validates the *value* of any attribute declared `type="boolean"` /
`type="java.lang.Boolean"` when that value is a literal (not an EL expression), e.g.:

```jsp
<my:avatar persno="${person}" />        <!-- squiggle: "persno" isn't declared -->
<my:avatar linked="fasle" />            <!-- squiggle: not "true" or "false" -->
```

The boolean check exists because JSP's `Boolean` property editor doesn't reject a bad
literal at request time — it silently treats anything other than `"true"`
(case-insensitively) as `false` — so a typo like this is a silent runtime bug rather
than a startup or compile failure, and static tooling is the only thing that catches
it before it ships. It does not check required-ness, or any other declared type.

Separately, a `.tag` file's own `<%@attribute%>` directives are checked regardless of
how (or whether) the tag is used anywhere: a `required` or `rtexprvalue` value that
isn't `"true"`/`"false"` is flagged as a mistake in the declaration itself, e.g.:

```jsp
<%@attribute name="tabIndex" required="fallse" rtexprvalue="true" %>   <!-- squiggle -->
```

Per the JSP spec these fields only have defined meaning for those two literals; what a
bad value actually resolves to at translation time is container-specific and isn't
verified here — it's flagged simply for not being a valid boolean.

The name and type checks skip any tag file that declares
`<%@tag dynamic-attributes="...">`, since that means the tag accepts arbitrary
attribute names by design (collected into a Map rather than being an error). The
`required`/`rtexprvalue` check applies regardless, since it's about the declaration's
own syntax, not about how callers use the tag. Runs on open, edit (debounced), and
save; a `.tag` file's own declarations are cached and invalidated when that file is
saved.

The same checks apply to `uri`-bound tags backed by a Java-class `<tag>` entry (type
6b above) — `<fmt:formatDate bogus="...">` gets flagged the same way, checked against
the `<attribute>` names (and `<type>`, for the boolean check) the TLD (workspace or
jar-bundled, see "Jar-bundled TLDs") declares for that tag, and skipped if the TLD
sets `<dynamic-attributes>true</dynamic-attributes>`. As with tag-class resolution, a
`<tag-file>`-backed tag has no attribute list parsed here to check against, so it's
silently skipped rather than flagged — never a false positive, but also no coverage
for that variant.

## Attribute completion

Typing a custom tag's own name (e.g. `<sm:|` or `<my:|`) suggests every tag name
available for that prefix, e.g. `url`, `set`, `if`, ... for `sm:`. Covers both binding
kinds: for a `uri`-bound taglib (JSTL `c:`/`fmt:`, the Supermodel `sm:` taglib, ...),
listing every name is just exposing `TldIndex`'s existing per-taglib name → tag-class
map (workspace or jar-bundled, see "Jar-bundled TLDs" above); for a `tagdir`-bound
prefix (this codebase's own `.tag`-file-backed tags, e.g. `<my:avatar>`), it's every
`.tag` file directly under that directory — a workspace glob for local ones, and, per
"Webapp-relative paths supplied by a dependency jar" above, whatever a classpath jar
supplies via `META-INF/resources` for the rest (e.g. Supermodel's own tag files).
Non-recursive either way: `<my:` (tagdir `/WEB-INF/tags`) doesn't also suggest tags from
`/WEB-INF/tags/sidebar`, which is `sidebar:`'s own, separate tagdir binding.

Typing inside a custom tag's opening element (e.g. `<sm:url |`) suggests its declared
attribute names, each labelled with its Java type and whether it's required, e.g.
`codeOrId: java.lang.String` or `route: java.lang.String (required)`. Accepting one
inserts `name=""` with the cursor left between the quotes. Attributes already present
elsewhere in the same tag are left out of the list. Typing inside the quotes of an
attribute declared `type="boolean"` / `type="java.lang.Boolean"` (e.g.
`<sm:url addContextPath="|"`) instead suggests `true`/`false` — the two literals that
check actually accepts (see "Tag attribute validation" above).

This covers the same tag kinds as tag attribute validation above — `tagdir`-backed
`.tag` files and `uri`-bound Java-class `<tag>` entries — reuses the same
`TagAttributesResolver`, and is silent under the same conditions (dynamic-attributes,
an unresolvable tag, a `<tag-file>`-backed tag). Unlike validation, this doesn't need
the tag to be closed with a `>` yet — it works off of whatever's been typed of the
attribute list so far.

## Directive support

Every directive the Jakarta Server Pages spec defines — `<%@page%>`, `<%@include%>`,
`<%@taglib%>`, `<%@tag%>`, `<%@attribute%>`, `<%@variable%>` — gets hover and completion
for its own attributes, from a static table of what the spec says each one accepts
(`directiveAttributes.ts`; unlike everything else in this README, there's nothing in the
workspace or on the classpath to resolve this against — it's just what the spec says).

**Hovering the directive's name** (e.g. "attribute" in `<%@attribute name="x" %>`) shows
what the directive is for and every attribute it accepts, e.g.:

```jsp
<%@tag body-content="scriptless" %>
     ^^^
     <%@ tag %>
     A .tag file's own equivalent of the page directive -- defines attributes of
     the tag file as a whole.

     - display-name: Short name for this tag, intended for display by tools.
     - body-content: What kind of body content this tag accepts. (`empty` | `scriptless` | `tagdependent`)
     - dynamic-attributes: ...
     ...
```

**Hovering one attribute name** instead (e.g. just `body-content`) shows only that
attribute's own description, e.g. `body-content: What kind of body content this tag
accepts. (`empty` | `scriptless` | `tagdependent`)`.

**Completion** covers all three parts of a directive. Typing the directive's own name
(e.g. `<%@|`) suggests `page` / `include` / `taglib` / `tag` / `attribute` / `variable`
-- even simpler than `uri`-bound custom-tag-name completion above, since the six
directive names are just the fixed keys of `DIRECTIVES` rather than something to look up
per-taglib. Once a directive name is fully
typed, completion works the same way as custom tag attribute completion above: typing
inside the directive (e.g. `<%@page |`) suggests its attribute names not already present
elsewhere in the same directive, and typing inside the quotes of an attribute
constrained to a fixed set of values — every boolean-valued one (`required`,
`isELIgnored`, ...), plus the enum-valued `body-content` and `scope` — suggests those
values, e.g. `<%@tag body-content="|"` -> `empty` / `scriptless` / `tagdependent`. None
of these three need the directive to be closed with `%>` yet.

Attribute name/value completion is silent for a directive name the table doesn't
recognize (not a real directive) or an attribute name the directive doesn't declare
(most likely a typo — see "Directive attribute validation" below for the diagnostic that
actually flags it).

## Directive attribute validation

Flags a directive attribute usage (e.g. `<%@page pageEncdoing="UTF-8" %>`) whose name
isn't one `DIRECTIVES` declares for that directive — the same idea as tag attribute
validation above, but for directives instead of custom tags:

```jsp
<%@page pageEncdoing="UTF-8" %>        <!-- squiggle: "pageEncdoing" isn't declared -->
```

Also flags a literal value that doesn't match the attribute's fixed set of valid values,
when it declares one — every boolean-valued attribute (`required`, `isELIgnored`, ...),
plus the enum-valued `body-content` and `scope`:

```jsp
<%@attribute required="fallse" %>      <!-- squiggle: not "true" or "false" -->
<%@tag body-content="scriptles" %>     <!-- squiggle: not "empty"/"scriptless"/"tagdependent" -->
```

Unlike the equivalent check for custom tag attributes, there's no EL-expression
exception to make here: directive attribute values are always static string literals
per the JSP spec, never runtime expressions. Both checks are errors. Silent for a
directive name the table doesn't recognize (nothing to check its attributes against)
and for one that's still being typed (no closing `%>` yet) — this only looks at complete
directives. This also replaces the old, narrower check that only covered a `.tag` file's
own `<%@attribute%>` directive's `required`/`rtexprvalue` fields; that's now just one
case of this more general diagnostic. Runs on the same open/edit/save schedule as the
other diagnostics, and is included in the "Check All Files" command's batch run.

## Hover information

Alongside "go to definition", most of the links in "What it links" above also show a
hover — the same resolved target as a clickable link, without jumping to see it.
Anywhere the resolver can't find a declaration or target to show gets no hover at all,
rather than one with nothing useful in it.

**A custom tag's name** (e.g. `sm:url` in `<sm:url ... />`, either the opening or
closing tag) shows what backs it and every attribute it declares, each with its Java
type:

```jsp
<sm:url codeOrId="welcome" />
 ^^^^^^
 <sm:url>
 Backed by <its tag-handler class, or its .tag file path>

 - route: java.lang.String
 - codeOrId: java.lang.String
 - addContextPath: java.lang.Boolean
 ...
```

**One attribute name at a call site** instead (e.g. just `codeOrId`) shows that
attribute alone, plus whether it's `required`:

```jsp
<email:attribution-block bean="${_member}" ... />
                          ^^^^
                          bean: java.lang.Object (required)
```

An attribute with no declared `type` shows `java.lang.String`, the JSP spec's default.
Both tag hover forms cover the same tag kinds as the validation below (`tagdir`-backed
`.tag` files and `uri`-bound Java-class `<tag>` entries) and are silent under the same
conditions (dynamic-attributes — the tag-name hover instead notes it accepts arbitrary
attributes; unresolvable tag; `<tag-file>`-backed tag; an attribute name the tag
doesn't declare — the validation below already flags that last one as an error).

**An EL function call** (e.g. `lfn:checkCapability(...)`) shows the Java class/method
backing it — the same resolution "go to definition" (type 2 above) uses, surfaced
without jumping.

**An include path** (`<%@include file="...">` / `<jsp:include page="...">`, type 5
above) notes whether it resolves to a workspace file or a jar-bundled resource (see
"Webapp-relative paths supplied by a dependency jar" above).

**A bare FQCN reference** — `<jsp:useBean class="...">` (type 1), a scriptlet FQCN
(type 3), a `<%@page import="...">` entry, or a `.tag` file's own `<%@attribute
type="...">` (type 7) — links to the class, when jdtls can resolve it. Since the
class name is already fully visible as plain text in all of these, the hover only
appears at all when it resolves to something to link to.

Every link in every hover form above (attribute types included) uses the same class
resolution `resolveClass`/`resolveMember` use for "go to definition" — delegated to
whatever Java tooling is installed (redhat.java/jdtls) rather than parsed here, so it
also covers JDK types like `java.lang.String` when sources are attached.

## Bean/EL chain property validation (prototype)

Three related checks against a known Java type share one opt-out setting (below), since they're
the same tier of check -- jdtls-dependent, can under-cover but shouldn't false-positive.

### `<jsp:setProperty>` validation

Flags `<jsp:setProperty name="X" property="Y" .../>` when `X`'s known Java type -- a
`<jsp:useBean id="X" class="..."/>` (or `type="..."`) declaration, or a configured
`elBindingTags` binding (see "EL property-chain resolution" above) -- resolves to a Java
class jdtls can inspect, and that class has no JavaBean setter for `Y`:

```jsp
<jsp:useBean id="meViewingy" class="web.bean.MeViewingyBean" />
<jsp:setProperty name="meViewingy" property="preson" value="${user}" />  <!-- squiggle -->
```

Only checks that a same-named setter exists at all, not that its parameter type
matches the `value` expression. When `X`'s type isn't resolvable at all in the *same
file* (see the limitation below), this raises an `Information` diagnostic — "Type of
`X` couldn't be resolved, so `Y` isn't validated." — rather than a squiggle, so the gap
is visible without looking like a real bug (shared `untypedSourceDiagnostic` helper,
`diagnostics.ts`, also used by `field=` attribute validation below). Silently skipped
entirely — no diagnostic of either kind — when the declared class can't be resolved, or
`property="*"` (bind-everything-from-request-params) is used, since there's no single
property to check there.

Being a prototype with a real chance of being wrong for reasons outside this
extension's control (see the setting below), it has its own opt-out, unlike the
other, more established diagnostics: `vscode-jsp-linker.beanPropertyValidation.enabled`
(default `true`) -- shared with EL property-chain validation and `field=` attribute
validation below. Toggling it clears/re-shows all three checks' squiggles on all open
documents immediately, no reload needed.

Depends on the workspace's `java.symbols.includeGeneratedCode: true` setting (in both
`.vscode/settings.json` and `web/.vscode/settings.json`). Most JSP-facing beans in this
codebase declare their setters via Lombok's field-level `@Setter` rather than writing
them out, and jdt.ls's document outline omits Lombok-generated methods by default —
without this setting, the check would flag most real, valid usages as errors. The only
other side effect of that setting: Lombok-generated members now also show up in the
outline/breadcrumbs/"Go to Symbol in File" for Lombok-annotated classes generally, not
just JSP beans (it doesn't affect workspace-wide symbol search, which is a separate
setting).

Resolves `X`'s type via the same `VariableTypeResolver` "EL property-chain resolution"
above uses — not just `<jsp:useBean>` but also a configured `elBindingTags` binding, so
e.g.:

```jsp
<sm:set var="paginator" name="site" field="popularPersonPaginator"/>
<jsp:setProperty name="paginator" property="howMany" value="5" />
```

(see `WEB-INF/tags/sidebar/popular-people.tag`) now resolves `paginator`'s type from
`sm:set`'s own `field="popularPersonPaginator"` binding, once `sm:set` is configured in
`elBindingTags` (this workspace's is). Wired into "Check All Files" (`jsp-setproperty`
is in `checkAllCommand.ts`'s `DIAGNOSTIC_SOURCES`). See `setPropertyDiagnostics.ts` for
the rest of the fine print.

Also hoverable and cmd/ctrl-clickable, same as `field=` below — see its own note for how
this is implemented (`resolvePropertyNameTargetAt` in `tokenResolution.ts`, shared
between the two).

### EL property-chain validation

Flags an EL property-chain access (see "EL property-chain resolution" above) at the first
segment with no matching getter or method on the type reached so far:

```jsp
<sm:set var="_viewings" value="${_ppb.personProdsuction.authorisedViewings}"/>  <!-- squiggle -->
<sm:set var="_authorised" value="${_viewing.authorisde(authorisation)}"/>      <!-- squiggle -->
```

Walks the chain hop by hop the same way hover/"go to definition" do, via
`VariableTypeResolver` and `resolveMemberReturnType` (JavaBean getter-convention candidate names
for a bare property access, or the literal name alone for a trailing method call). Stops at the first hop it can't resolve *either way*: a segment with
no matching getter/method is flagged and the rest of the chain is left unchecked (unreachable
once this hop fails at runtime too); a segment jdtls simply can't answer yet (still indexing, or
its return type couldn't be parsed off its source) is silently skipped without flagging
anything, rather than guessing. Never checks *inside* a chain-ending *method* call's own argument
list (e.g. "authorisation" in `_viewing.authorised(authorisation)`) -- that would need the called
method's parameter types to check the argument against, which this extension doesn't attempt.

**Does** check inside an EL *function* call's arguments, though (e.g. `user.role` in
`${lfn:checkCapability(user.role, ...)}`) -- unlike a method call's argument, an EL function's
arguments are ordinary standalone EL expressions, not typed against a Java method signature, so a
real chain among them is exactly the kind of thing worth validating. `findAllElPropertyChains`
(`jspScan.ts`) recognizes the function's own `ns:name(` header via the same `EL_FUNCTION_CALL`
pattern used elsewhere in this file and recurses into its argument text, rather than misreading
the function's name as a chain's base variable with the argument list as a method call on it --
which is what it used to do, silently swallowing any real chain passed as an argument to *every*
EL function call in the codebase (confirmed against ~670 such usages, dominated by `enc:xml(...)`/
`enc:none(...)` output-encoding calls) rather than validating it. A chain whose *base* variable isn't in the
known-types map at all — most commonly Supermodel's implicit `name="object"`, see "Known
limitations" — is never checked at all, since there's no starting type to walk from; this is
under-coverage, not a false negative in the sense of missing a real bug this extension could
otherwise see. When that untyped base *is* at least a real declared variable (`ElNames.declared`,
built by `collectElNames` — e.g. `<sm:set var="homepage" codeOrId="..."/>` with no `field`), a
Hint is raised on it instead of staying silent, so "not validated" is visibly distinct from
"validated, and fine."

That Hint deliberately checks the narrower `declared` set rather than the broader `known` set
"Unknown EL variable" below uses — `known` also includes the JSP/EL spec's fixed implicit objects
(`param`, `header`, the `*Scope` maps, etc.) and EL's reserved words (`eq`, `ne`, `null`, `empty`,
...) parsed as bare one-segment pseudo-chains where they appear as operators/literals (e.g. the
`null` in `${x ne null}`) — neither of which is a real variable with a type that could ever
resolve, so Hinting on them would be permanent noise rather than a surfaced coverage gap. An
undeclared base already gets its own Warning from "Unknown EL variable" below, so this doesn't also
raise a Hint for that case.

Shares `vscode-jsp-linker.beanPropertyValidation.enabled` with `<jsp:setProperty>` validation
above and `field=` attribute validation below (same tier of check) and the same
`java.symbols.includeGeneratedCode: true` dependency to see Lombok-generated getters. Wired into
"Check All Files" (`jsp-el-chain` is in `checkAllCommand.ts`'s `DIAGNOSTIC_SOURCES`).

Implemented, together with "Unknown EL variable warning" below, by a single `ElDiagnostics` class
(`elDiagnostics.ts`) — both tiers ask the same underlying question about an EL chain's base
variable ("is it declared, is it typed, do its hops resolve?") at different confidence levels, so
one document scan feeds both rather than each tier re-scanning the file independently. The
severities, diagnostic sources, and opt-out settings described here stay fully independent per
tier; only the scanning and known-variable computation are shared.

**Known false-positive source**: a bean declared `<jsp:useBean id="object" type="java.lang.Object"
scope="request"/>` (a repeated convention in `WEB-INF/supermodel-local/editor/**`'s generic
per-type admin editor JSPs, e.g. `tmdbid.jsp`) resolves fine as a class — it's `java.lang.Object`
— but this check doesn't know that codebase convention means "no real static type available, this
JSP accesses whatever the concrete runtime object actually is". It'll flag e.g.
`${object.reallyUnsafeTmdbId}` as `java.lang.Object` having no such property, even though that's
legitimate Supermodel-style dynamic property access, not a typo. Not fixed here by design (for
now) — see the "EL property-chain resolution" section's own `object` discussion above for why
this is the same underlying limitation, just hitting an explicit `java.lang.Object` type instead
of an untyped implicit one.

### `field=` attribute validation

Flags a configured `elBindingTags` binding's own `field="..."` attribute (see "EL
property-chain resolution" above) when the *source* variable it reads that property off
resolves to a Java class jdtls can inspect, and that class has no JavaBean getter for
the named property:

```jsp
<jsp:useBean id="object" type="com.letterboxd.om.Genre" scope="request" />
<sm:forEach var="displayable" field="displayableGenres" .../>  <!-- squiggle -->
```

Before this existed, a typo'd `field=` like this produced no diagnostic at all —
`VariableTypeResolver` just silently left the declared variable (`displayable` above)
untyped, the same as any other unresolvable binding, rather than flagging the attribute
itself. The same shape of check as EL property-chain validation above, applied to a tag
attribute's own `field=` value instead of a `${...}` expression — walks the same
`resolveMemberReturnType` (with `getterCandidateNames`) this extension uses everywhere
else. When `source` doesn't resolve to a known Java type at all (most commonly
Supermodel's implicit `name="object"` left untyped, or a `.jspf` fragment that relies on
its includer to declare `source` — see "Known limitations" below), this raises an
`Information` diagnostic instead of a squiggle — same `untypedSourceDiagnostic` helper
`<jsp:setProperty>` validation above uses.

Shares `vscode-jsp-linker.beanPropertyValidation.enabled` with the two checks above (same
tier) and the same `java.symbols.includeGeneratedCode: true` dependency. Implemented by
its own `TagFieldDiagnostics` class (`tagFieldDiagnostics.ts`, collection
`jsp-tag-field`), wired into "Check All Files" the same way the other checks are.

Also hoverable and cmd/ctrl-clickable (`resolvePropertyNameTargetAt` in
`tokenResolution.ts`) — same as `<jsp:setProperty>`'s own `property=` value below —
showing/linking the resolved getter, exactly like an EL chain segment does. When
`source` is a real variable but its own type couldn't be resolved, hovering still shows
*why* nothing links — "Type of `X` couldn't be resolved, so `field` isn't validated." —
the same "say why, don't go silent" reasoning as the Hint under "EL property-chain
validation" above, rather than looking identical to hovering plain text.

## Unknown EL variable warning

Flags an EL property-chain access (`${x.y.z}`) whose *base* variable `x` isn't declared
anywhere this extension recognizes in the file, e.g.:

```jsp
<sm:cacheKey esi="true" object="${object}"/>
<h2><sm:choose><sm:when test="${user.capabilities.hasStaffRole}">...  <!-- squiggle: "user" -->
```

(`WEB-INF/templates/esi/person/profile.jsp` — this is a real example: `user` isn't
declared via `jsp:useBean`, an `elBindingTags`-configured tag, `varStatus`, or a tag-file
attribute anywhere in this ESI fragment, and reading a per-viewer variable inside a
Varnish-cached ESI fragment would leak between visitors if it worked at all.)

"Declared" means one of:

- `<jsp:useBean id="X" ...>` (regardless of whether `class`/`type` resolves to a real
  Java type — that's the "EL property-chain validation" tier's concern, not this one).
- A `vscode-jsp-linker.elBindingTags`-configured tag's `var` attribute (see "EL
  property-chain resolution" above) — recorded even when its own type doesn't resolve,
  same reasoning as the previous point.
- `varStatus="X"` on *any* tag usage — a JSTL/Supermodel-wide loop-status convention
  (`${_status.count}`, `${_status.last}`, ...), not tied to one specific tag the way
  `elBindingTags` is, so this is recognized regardless of which tag declares it.
- In a `.tag` file, its own `<%@attribute name="X">` declarations — an implicitly scoped
  EL variable for that tag file alone.
- One of the JSP/EL spec's fixed implicit objects (`pageContext`, `pageScope`,
  `requestScope`, `sessionScope`, `applicationScope`, `param`, `paramValues`, `header`,
  `headerValues`, `initParam`, `cookie`) — a static list, not configurable, same
  reasoning as the `DIRECTIVES` table in `directiveAttributes.ts`.

This is a **Warning**, not an Error, and gets its own opt-out setting
(`vscode-jsp-linker.elUnknownVariableWarning.enabled`, default `true`) rather than
sharing `beanPropertyValidation.enabled` — it's a different confidence tier (this check
doesn't touch jdtls at all, it's purely syntactic) and a much weaker signal: an unknown
base variable might be a real bug (a typo, or a variable genuinely out of scope), or it
might legitimately read a request/session-scope attribute set by Java code this scanner
has no way to see — both look identical from JSP source alone.

**This under-covers less than the getter-chain check above by design, and that's noisy in
practice.** Unlike that check, this one doesn't quietly skip a chain just
because its base variable's *source* isn't something this extension specifically models
— Supermodel's implicit `name="object"` convention (documented at length under "EL
property-chain resolution" and "Known limitations" above) is exactly this kind of
undeclared-but-legitimate base, and it is flagged here: `${object.anything}` squiggles
in the ~95% of this codebase's templates that use `object` without a local
`<jsp:useBean id="object" ...>`. So does `${user.anything}` everywhere it isn't declared
via a tag-file attribute — confirmed, by inspection, to be the same kind of
framework-provided implicit binding as `object` in every case except the ESI one above.
Checked against the whole `WEB-INF` tree, this currently produces on the order of two
thousand warnings across a third of the codebase's JSP/tag files, dominated by `object`
and `user` plus a long tail of other tags' loop variables (`stats`, `row`, `template`,
...) that aren't yet covered by `elBindingTags`/`varStatus`. Deliberately shipped this
way rather than scoped down to just ESI/CSI fragments (where the false-positive rate
would be far lower) — the tradeoff was to keep the check general per the extension's
existing "no assumptions about a specific tag library baked in" philosophy, accepting
the noise for now. Configuring more of this codebase's own loop-like tags into
`elBindingTags` (`.vscode/settings.json`) is the main lever to cut it down over time,
same mechanism "EL property-chain resolution" above already uses.

## Broken link diagnostics

Separately from tag attributes, the extension flags links from the list above that
wouldn't actually navigate anywhere:

- **`<%@include file="...">` / `<jsp:include page="...">`** pointing at a file that
  doesn't exist *and* isn't supplied by a dependency jar either (see "Webapp-relative
  paths supplied by a dependency jar" above). A file-relative include (no leading `/`)
  is always a sibling of the including file, so a missing target is an **error**. A
  webapp-root-relative include (leading `/`) that neither check finds is only a
  **warning**, since the classpath scan itself can be inconclusive (Java extension not
  active, `unzip` missing, etc.) rather than proof the path is actually wrong.
- **Custom tags** (`<my:avatar>`) whose prefix resolves to a `tagdir`, but no `.tag`
  file exists there locally or in a dependency jar — a **warning** for the same reason.
- **Custom tags whose prefix resolves to a `uri`-bound taglib instead** (`<sm:foo>`,
  `<c:bogus>`) where that taglib *is* indexed — workspace `.tld` or jar-bundled (see
  "Jar-bundled TLDs" above) — but declares neither a Java-class `<tag>` nor a
  `<tag-file>` entry with that name — an **error**, same confidence as the EL function
  check below (the taglib's full tag list is known once it's indexed, so "declares
  neither" is deterministic). A `<tag-file>` entry's own name is now parsed
  specifically so this doesn't false-positive on that variant — see
  `tldParsing.ts`'s `tagFileNames`. A prefix bound to a taglib not indexed anywhere is
  left unchecked, same as the EL function case.
- **EL function calls** (`lfn:checkCapability(...)`, `fn:escapeXml(...)`) where the
  prefix's taglib *is* indexed — from a workspace `.tld` or a jar-bundled one (see
  "Jar-bundled TLDs" above) — but declares no function with that name — a likely typo,
  and fully deterministic, so this is an **error**. Calls through a taglib not indexed
  anywhere (its TLD couldn't be found in the workspace or on the classpath) are left
  unchecked rather than reported, since there's nothing to check them against.
- **EL function calls whose prefix isn't bound by any `<%@ taglib %>` directive at
  all** (in the document itself, or anywhere in its `<%@include%>` chain) — also an
  **error**, same confidence as above: if nothing binds the prefix to a taglib in the
  first place, there's no way the call could ever resolve. The one exception is a call
  declared in
  `vscode-jsp-linker.compilerRecognizedElFunctions` (see "Settings" below) — a call some
  external tool resolves outside the taglib mechanism entirely, so no directive will ever
  exist for it. This codebase's own `.vscode/settings.json` declares `enc:xml`/`enc:none`
  this way: `letterboxd-jasper` (this repo's patched fork of Apache Tomcat's Jasper, see
  `web/pom.xml`) recognizes both by matching an EL expression's literal text at compile
  time — its `isEscapePageEL` output-encoding support — rather than dispatching them
  through the ordinary FunctionMapper/taglib machinery this extension otherwise models,
  so no `.tld` or `<%@ taglib %>` directive for either will ever exist to find.
- **Java class references** (`jsp:useBean`, tag `<%@attribute type="...">`, and
  fully-qualified names in scriptlets) that don't resolve via the Java extension —
  a **warning**, since resolution is delegated to `redhat.java` and may simply not
  have finished indexing yet; this check is skipped entirely when that extension
  isn't active.

Only file-relative includes, taglib-indexed EL function calls, and taglib-indexed
custom tag names are checked against something fully local and certain (the
filesystem, or this extension's own TLD index) and reported as errors; everything else
can be legitimately supplied by tooling or
dependencies outside the workspace, so it's a warning rather than a hard error. Runs on
the same open/edit/save schedule as tag attribute validation.

## Settings

Most of this extension's diagnostics (tag/directive attribute validation, broken link
diagnostics, TLD class validation) have no opt-out setting at all — they're always on.
Only `vscode-jsp-linker.beanPropertyValidation.enabled` and
`vscode-jsp-linker.elUnknownVariableWarning.enabled` (see "Bean/EL chain property
validation" and "Unknown EL variable warning" above) are toggleable. That split follows
one policy: a **structural or typo check that can't reasonably false-positive** — an
attribute name a tag genuinely doesn't declare, a link that genuinely doesn't resolve to
a file, a literal that genuinely isn't `"true"`/`"false"` — stays always-on, since
turning it off would only ever hide a real bug. A check that **depends on possibly-
incomplete type inference and can legitimately false-positive** — because this scanner's
model of "what's declared" or "what a variable's Java type is" is necessarily incomplete
(see "Known limitations" below) — gets its own toggle instead, so a workspace that finds
one too noisy for its own conventions can turn just that one off without losing the
rest. `jsp-setproperty`, `jsp-tag-field`, and `jsp-el-chain` all share
`beanPropertyValidation.enabled` (one jdtls-dependent tier: can under-cover, but the
policy above still holds — none of the three should false-positive) rather than each
getting its own setting, since splitting a single tier of check across several toggles
would just be more settings to reason about for no real gain in control.

`vscode-jsp-linker.compilerRecognizedElFunctions` (see "Broken link diagnostics" above)
isn't a toggle — like `elBindingTags`, it's plain data the extension has no opinion
about, empty by default. A workspace declares the `prefix:name` calls its own JSP
compiler resolves outside the taglib mechanism (e.g. this repo's `enc:xml`/`enc:none`),
and the extension treats exactly those as expected and unlinkable rather than as a
possible typo — see `TldIndex.checkFunctionCall`.

## Generated Java / Class CodeLens / context menu

`.tag` and `.jsp` files can show a CodeLens for each Jasper-generated artifact that
actually exists on disk — a `.java` and/or a `.class`, searched for independently:

- `.java` is only produced by a locally-run embedded Tomcat (the `dev` Maven profile,
  m2e-only) the first time it actually serves that page/tag — Jasper compiles lazily,
  on first request, so most files won't have this.
- `.class` is also produced by the build-time `jspc` Maven plugin (`mvn install -Pcli`
  / `bin/build.sh`, the `jetty-ee10-jspc-maven-plugin`), so it covers more files than
  `.java` does. It's raw bytecode, so opening it (via the generic `vscode.open` command,
  the same path a normal double-click takes) won't show readable source — there's no
  decompiler for a loose `.class` file the way there is for dependency jars the Java
  extension manages — but it's still useful for confirming the artifact exists and
  seeing whatever VSCode's default binary-file handling shows for it.

Both searches use a broad glob rather than a hardcoded path, so they match whichever
build/run output directory happens to have produced the file (`target/classes`,
`target/build-cli/classes`, an exploded WAR, or a Tomcat work directory). No CodeLens is
shown for an artifact that doesn't exist, rather than a broken link. The target path is
computed via Jasper's standard name-mangling (non-identifier characters -> `_XXXX` hex
escapes): tag files always compile under the fixed package `org.apache.jsp.tag.web`
regardless of their real subdirectory, while ordinary JSPs mirror their *entire*
webapp-relative path (including `WEB-INF` itself) into the package, e.g.
`WEB-INF/templates/object/filmlist.jsp` -> `org.apache.jsp.WEB_002dINF.templates.object.filmlist_jsp`.

There are also "Open Generated Java (Jasper)" / "Open Generated Class (Jasper)"
right-click menu items (editor content, editor tab, and Explorer context menus) on any
`.tag`/`.jsp` file. Unlike the CodeLenses, these always show up (they're deliberate
actions, not passive indicators) — if the corresponding artifact doesn't exist yet,
they report that clearly instead of doing nothing.

## Known limitations

- Scriptlet linking resolves classes only, not method calls on them.
- Custom tag *navigation* (types 5 and 5b — cmd/ctrl-click a tag name to jump to its
  definition) only covers tags backed by a `tagdir` or a Java-class `<tag-class>`
  entry. A `uri`-bound taglib can also supply a tag via a `<tag-file>` entry (a
  packaged `.tag` resource inside the jar rather than a Java class) — its `<path>`
  isn't parsed, so cmd/ctrl-click on one of these still won't jump anywhere. This
  *is* used by a taglib this codebase depends on: Supermodel's own `sm:` declares two
  (`sm:bug`, `sm:search-debug`) — confirmed by inspecting `supermodel_rt.tld` directly.
  This is narrower than it sounds, though: the tag's *name* is recognized (see the
  next bullet) — it's only the jump-to-source that's missing.
- Broken-link diagnostics now do flag an unresolvable `uri`-bound custom tag name
  (`<sm:foo>` where `foo` is neither a `<tag>` nor a `<tag-file>` entry in the indexed
  taglib) as an error — see "Broken link diagnostics" above. This was previously
  unchecked specifically to avoid false-positiving on the `<tag-file>` variant from the
  previous bullet; parsing `<tag-file>` entries' names (not their `<path>`, just enough
  to know the name exists) closed that gap.
- EL expressions that read request/session/page-scope attributes (e.g.
  `${object.values.preheader}`) are **not** linked back to the Java code that set
  those attributes — that requires a full data-flow/type-inference model, which is a
  separate, much larger effort than this extension. "EL property-chain resolution" above
  covers the *narrower* case of a chain rooted in a `jsp:useBean`/configured-tag-declared
  variable — deliberately not this one. `object` specifically is often (not always --
  some files, e.g. `custom-backdrops.jspf`, give it a real `<jsp:useBean id="object"
  type="...">`) left as the generic `type="java.lang.Object"`, in which case there's no
  static type to recover at all short of parsing the owning screen's Java source (itself
  only heuristically knowable at best, and not attempted).
- ~~**`sm:forEach`'s `paginator="..."` attribute isn't modeled by `elBindingTags`**~~
  **Resolved.** Two parts, both now implemented:
  - **Wiring the attribute itself**, via a generic `alternateSources` config field
    (`BindingTagConfig.alternateSources` in `variableTypes.ts`): any tag can declare one
    or more attributes that supply `source`+a config-fixed `field` together, as an
    alternative to the ordinary `source`/`field` attribute pair -- there's nothing
    `paginator`-specific in the extension's own code, only in `sm:forEach`'s entry in
    `.vscode/settings.json` (`"alternateSources": [{ "attribute": "paginator", "field":
    "page" }]`), matching `ForEachTagBase.setPaginator(String)`
    (`ForEachTagBase.java:335-336`, stores it as a plain pageContext-variable name, read
    via `pageContext.findAttribute(...)` in `prepare()`, lines 170-177) and
    `Paginator<T>.getPage()`. E.g. `<sm:forEach paginator="paginator" var="_hq">`
    (`members-hq.jsp`) now resolves as a `'field'` usage (`source: "paginator"` reads its
    own value, `field: "page"`) instead of `'unresolved'`.
  - **Unwrapping the loop variable's element type**, previously the harder half: a
    paginator's `getPage(): List<T>` is declared once, on the generic
    `com.cactuslab.pages.Paginator<T>`/`AbstractPaginator<T>`
    (`foundation/pages/src/main/java/com/cactuslab/pages/` in `supermodel-trio`), and
    never re-declared with a concretized signature anywhere down a concrete subclass's
    hierarchy (e.g. `Site.getHqPaginator(): PersonWithRolePaginator`, where
    `PersonWithRolePaginator extends AbstractCQBPaginator<Person, Person, Person>` --
    element type baked into the `extends` clause's type *arguments*, not any method's
    return-type text) -- `unwrapCollectionElementType`'s own regex has nothing to match
    on the raw, unsubstituted `"List<T>"` text alone.

    First closed by giving `resolveInheritedMember`'s existing hop-walking machinery
    (`walkSupertypes` in `javaSymbols.ts`) real positional generic substitution -- except
    that first attempt never actually worked. `resolveHopSubstitution` assumed jdtls's own
    `resolveTypeHierarchy` response carried a hop's generic-instantiation text on its
    `supertype.name` field (e.g. `"AbstractCQBPaginator<Person, Person, Person>"`); live
    debugging (raw jdtls response dumps, plus decompiling the server's actual
    `TypeHierarchyItem` DTO via `javap`) confirmed `name` is *always* jdtls's bare simple
    class name, never that. Every generic member reached through an inherited hop -- not
    just the one construct that originally surfaced this section -- silently showed its
    raw, unsubstituted type instead of the correct one, undetected until then because none
    of this jdtls-dependent code had ever had automated test coverage.

    jdtls has no field anywhere that carries a hop's own generic arguments (confirmed the
    same way: `DocumentSymbol.detail` is empty for a Java class/interface symbol too), so
    the only remaining source of truth is the declaring class's own source text. Closed
    for real by `javaHeritageClause.ts`, a `vscode`-free module unit-tested with plain
    `node --test` (`src/__tests__/javaHeritageClause.test.ts`) against this repo's own real
    inheritance shapes (`ICQBPaginator`'s multi-entry interface `extends`,
    `AnythingListPaginator`'s wildcard-bounded own type parameter, `SingleProductionViewingPaginator`'s
    bounds referencing each other with a dotted nested-class type argument) as well as
    synthetic edge cases (`sealed ... permits`, records, literals/comments/text blocks
    that merely contain the text `extends`/`implements`). `resolveHopSubstitution` now
    reads the child's own source text (sliced from just past its name, via
    `child.selectionRange.end`/`child.range.end` -- already present on the
    `JavaTypeHierarchyItem` the walk already fetched) through
    `extractHeritageTypeArguments` to get this hop's own `extends`/`implements` clause
    argument list for the supertype -- first run through the *parent* hop's
    already-accumulated map, so the substitution composes correctly across however many
    hops separate the concrete class from where the member is actually declared -- and the
    supertype's own declared parameter names through `extractDeclaredTypeParameters`, off
    its own source text (not `DocumentSymbol.name`, which -- unlike the disproven
    `supertype.name` -- was never itself confirmed live either, so there was no reason to
    leave that half of the computation on an unverified field once the other half needed
    fixing anyway). `findMemberOnSupertype` applies whichever hop's map is in effect to the
    member's extracted return-type text the moment it's found. Not the "scoped-down… just
    chase `Paginator<T>`" fallback once considered here -- genuinely general substitution,
    so it benefits any generic-hierarchy member lookup in this extension, not just
    paginators. Before this, an explicit `<jsp:useBean id="_hq"
    type="com.letterboxd.om.Person" scope="page"/>` right after the tag opens (same
    pattern as `_member` in `find-account.jsp`) was needed to get full validation for one
    specific loop variable -- no longer necessary for a paginator whose hierarchy this can
    walk.
  - **A *direct* (not inherited) member of an already-generic instantiation had the same
    gap**, just one level shallower: `resolveMemberReturnTypeUncached`'s own lookup (before
    ever reaching `resolveInheritedMember`'s hop walk above) read a member's return type
    straight off the type's raw source too -- e.g. `java.util.Map.Entry<K,V>.getKey()`
    reads as literally `"K"` in the JDK's own source, wrong once `fqcn` is a concrete
    instantiation like `Map.Entry<java.lang.String,...>` (the shape
    `unwrapCollectionElementType` now produces for a `Map`-iterating forEach's loop
    variable, e.g. `searchresults.jsp`'s `<sm:forEach name="searchFilterOptions"
    var="_option">` then `_option.key`/`_option.value...`). Closed the same way, not a
    second copy: `resolveHopSubstitution`'s "own declared parameters -> instantiated
    arguments" computation is now `typeVariableSubstitution`, and reading "own declared
    parameters" off the declaring type's own source text (`extractDeclaredTypeParameters`,
    via `rootSubstitutionFor`) is shared by both call sites, applied at the lookup's own
    starting type as well as at each hop above it.
- No automated test suite yet; a `@vscode/test-electron` harness would be a reasonable
  fast-follow.
- Dependency-jar resource resolution (see above) shells out to the `unzip` CLI rather
  than bundling a zip library, and assumes each Maven module maps to one Java-extension
  project rooted at that module's directory (true for this repo's M2E-imported layout).
  It's untested on Windows, where `unzip` isn't guaranteed to be on `PATH`.
- A tag's declared `<body-content>` (`empty` / `JSP` / `scriptless` / `tagdependent`)
  isn't parsed anywhere, so there's no hover/diagnostic explaining why e.g.
  `<sm:url>/create-account/</sm:url>` is allowed to have a body at all, or flagging one
  passed to a tag whose body-content is `empty`. Mainly relevant to `uri`-bound tags,
  where it varies per tag-class; `.tag` files here all rely on the unoverridden
  `scriptless` default. Would slot into `tldParsing.ts`'s existing `<attribute>`
  parsing and the tag-name hover in `jspHoverProvider.ts`.

## Guardrails for changes to this extension

Two failure patterns have independently cost real time here, each confirmed more than once —
anyone touching this code (including a future AI session picking up work on it) should actively
check for both before considering a change done, not just fix the specific bug reported.

**Never let a duplicate implementation of the same concept drift.** The same logical operation
getting a second, independent implementation elsewhere in this plugin is the single most common
source of real bugs here. Confirmed repeatedly, most recently: a second `<jsp:useBean>`-scanning
regex (`USE_BEAN_CLASS`, backing hover/"go to definition"/class-existence checking) never received
the quote-aware fix its sibling scanner (`scanUseBeanTags`, backing `<jsp:setProperty>`/EL-chain
typing — see "EL property-chain resolution" above) got for a generic `type="..."` value, so a
`<jsp:useBean type="java.util.Map<String,Foo>">` silently vanished from hover/link-checking while
working fine everywhere else — fixed by deleting the duplicate and having both consumers share the
one already-fixed scan (`jspScan.ts`'s `scanUseBeanTags`). Before writing new logic here, grep for
whether an equivalent scan/resolver/diagnostic-builder already exists; when two code paths do "the
same kind of thing" slightly differently, that's a bug to unify, not an acceptable stylistic
difference — even if each looks correct in isolation.

**Never let "couldn't determine" collapse into total silence.** A resolution step that can't
confidently answer (an unresolved generic type variable, a class not yet indexed by jdtls, an
unexpected shape a hand-rolled regex doesn't handle) must never be indistinguishable from "checked,
and fine" — surface it, even at `Information` severity, so a real coverage gap stays visible rather
than reading as a clean bill of health (see `unknownMemberDiagnostic` in `javaSymbols.ts`, the
`'unknown'`-status sibling to `missingMemberDiagnostic`, for the established pattern). This includes
exception containment: every diagnostics provider's own `validate()` must not let a thrown exception
silently prevent its own (or a sibling provider's) diagnostics from being shown for that document —
see `runProvider` in `extension.ts`, added specifically because the interactive open/edit/save path
had no equivalent to `checkAllCommand.ts`'s own `reportValidationFailure` until an audit found the
gap. When adding a new diagnostics provider (or a new resolution primitive with an "abstain" case),
check both: does an equivalent already exist to extend instead of duplicate, and does every path
through it that can't confidently resolve something still produce a visible signal?

## Development

```bash
nvm use   # picks up .nvmrc (24), matching web/.nvmrc
npm install
npm run compile   # or: npm run watch
```

Press F5 (or run the "Run JSP Linker Extension" launch config) to open an Extension
Development Host with this extension loaded against the repo root.
