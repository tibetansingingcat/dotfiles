(val_definition
  pattern: (identifier) @variable.identifier
  "=" @variable.value_separator
  value: (_) @variable.value) @variable.declaration

(var_definition
  pattern: (identifier) @variable.identifier
  "=" @variable.value_separator
  value: (_) @variable.value) @variable.declaration
