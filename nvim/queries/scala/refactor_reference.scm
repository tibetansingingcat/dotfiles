; val/var definitions as write references
(val_definition
  type: (_) @_type
  pattern: (identifier) @reference.identifier
  (#set-type! scala @_type @reference.identifier)
  (#set! reference_type write)
  (#set! declaration))

(var_definition
  type: (_) @_type
  pattern: (identifier) @reference.identifier
  (#set-type! scala @_type @reference.identifier)
  (#set! reference_type write)
  (#set! declaration))

(val_definition
  pattern: (identifier) @reference.identifier
  (#set! reference_type write)
  (#set! declaration))

(var_definition
  pattern: (identifier) @reference.identifier
  (#set! reference_type write)
  (#set! declaration))

; Function parameters
(parameter
  name: (identifier) @reference.identifier
  (#set! declaration))

; Function definition name
(function_definition
  name: (identifier) @reference.identifier
  (#set! reference_type write)
  (#set! declaration))

; var reassignment
(assignment_expression
  left: (identifier) @reference.identifier
  (#set! reference_type write))

(assignment_expression
  right: (identifier) @reference.identifier
  (#set! reference_type read))

; Arguments in function calls
(arguments
  (identifier) @reference.identifier
  (#set! reference_type read))

; Field/method access object
(field_expression
  (identifier) @reference.identifier
  (#set! reference_type read))

; Function call as identifier
(call_expression
  function: (identifier) @reference.identifier
  (#set! reference_type read)
  (#set! function_call_identifier))

; Return expression
(return_expression
  (identifier) @reference.identifier
  (#set! reference_type read))
