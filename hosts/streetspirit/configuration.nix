{ pkgs, vars, ... }:

{
    imports = [
      ../../darwin
    ];

    users.users.${vars.user} = {
        name = ${vars.name};
        home = "/Users/${vars.user}";
      };
}
