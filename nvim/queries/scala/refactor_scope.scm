; Function/method scope includes parameters
(function_definition
  parameters: (_) @scope
  body: (block
    .
    (_) @scope.inside) @scope)

; class/object/trait template body scopes
(class_definition
  body: (template_body
    .
    (_) @scope.inside)) @scope

(object_definition
  body: (template_body
    .
    (_) @scope.inside)) @scope

(trait_definition
  body: (template_body
    .
    (_) @scope.inside)) @scope

; Generic block scope (not directly inside a function body)
(_
  (block
    .
    (_) @scope.inside) @_block
  (#not-has-parent? @_block function_definition)) @scope
