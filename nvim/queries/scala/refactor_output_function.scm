(class_definition
  body: (template_body
    ([
      (comment)
      (block_comment)
    ]* @output_function.comment
      (function_definition) @output_function)))

(object_definition
  body: (template_body
    ([
      (comment)
      (block_comment)
    ]* @output_function.comment
      (function_definition) @output_function)))

(trait_definition
  body: (template_body
    ([
      (comment)
      (block_comment)
    ]* @output_function.comment
      (function_definition) @output_function)))
