(if_expression
  (#set! text if)) @debug_path_segment

(for_expression
  (#set! text for)) @debug_path_segment

(while_expression
  (#set! text while)) @debug_path_segment

(match_expression
  (#set! text match)) @debug_path_segment

(function_definition
  name: (_) @_name
  (#set! text @_name)) @debug_path_segment

(class_definition
  name: (_) @_name
  (#set! text @_name)) @debug_path_segment

(object_definition
  name: (_) @_name
  (#set! text @_name)) @debug_path_segment
