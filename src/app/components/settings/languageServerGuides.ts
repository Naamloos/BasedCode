// Custom installs may use a full path or a Windows executable suffix.
export function languageServerExecutable(command: string): string {
  return command.split(/[\\/]/).pop()!.replace(/\.(exe|cmd|bat)$/i, '');
}

const npmDetail =
  'Requires Node.js and npm. Use the Set up button to install it into BasedCode storage, or install it yourself with this command.';
/** Known servers: install hints for missing ones and presets for the add dialog. */
export const languageServerGuides = [
  {
    name: 'C# / Roslyn',
    languages: ['csharp'],
    install: 'dotnet tool install --global roslyn-language-server --prerelease',
    command: 'roslyn-language-server',
    args: ['--stdio', '--autoLoadProjects'],
    detail:
      'Requires the .NET 10 runtime or later and the SDK needed by your project. Automatic project loading opens your solution or discovers .csproj files. Global .NET tools are also detected outside PATH.',
    docs: 'https://github.com/dotnet/roslyn/blob/main/src/LanguageServer/roslyn-language-server/README.md',
  },
  {
    name: 'TypeScript / JavaScript',
    languages: ['typescript', 'javascript', 'typescriptreact', 'javascriptreact'],
    install: 'npm install -g typescript-language-server typescript',
    command: 'typescript-language-server',
    args: ['--stdio'],
    detail:
      'Requires Node.js and npm. Both the server and TypeScript must be installed. Workspace packages are discovered automatically; keep tsconfig.json or jsconfig.json in your project.',
    docs: 'https://github.com/typescript-language-server/typescript-language-server',
  },
  {
    name: 'Python',
    languages: ['python'],
    install: 'npm install -g pyright',
    command: 'pyright-langserver',
    args: ['--stdio'],
    detail:
      'Requires Node.js and npm for this server. Configure your Python environment in pyrightconfig.json or pyproject.toml when automatic environment detection is insufficient.',
    docs: 'https://github.com/microsoft/pyright',
  },
  {
    name: 'Vue',
    languages: ['vue'],
    install: '',
    command: 'vue-language-server',
    args: ['--stdio'],
    detail:
      'BasedCode setup installs @vue/language-server 2.2.12 with TypeScript 5 and supplies the TypeScript SDK path. Vue server 3.x needs a separate TypeScript plugin bridge and is not supported by this standalone client.',
    docs: 'https://github.com/vuejs/language-tools',
  },
  {
    name: 'JSON / JSONC',
    languages: ['json', 'jsonc'],
    install: 'npm install -g vscode-langservers-extracted',
    command: 'vscode-json-language-server',
    args: ['--stdio'],
    detail:
      'Requires Node.js and npm. The package provides several servers; use the JSON executable shown here.',
    docs: 'https://github.com/hrsh7th/vscode-langservers-extracted',
  },
  {
    name: 'HTML',
    languages: ['html'],
    install: 'npm install -g vscode-langservers-extracted',
    command: 'vscode-html-language-server',
    args: ['--stdio'],
    detail: npmDetail,
    docs: 'https://github.com/hrsh7th/vscode-langservers-extracted',
  },
  {
    name: 'CSS / SCSS / Less',
    languages: ['css', 'scss', 'less'],
    install: 'npm install -g vscode-langservers-extracted',
    command: 'vscode-css-language-server',
    args: ['--stdio'],
    detail: npmDetail,
    docs: 'https://github.com/hrsh7th/vscode-langservers-extracted',
  },
  {
    name: 'YAML',
    languages: ['yaml'],
    install: 'npm install -g yaml-language-server',
    command: 'yaml-language-server',
    args: ['--stdio'],
    detail: npmDetail,
    docs: 'https://github.com/redhat-developer/yaml-language-server',
  },
  {
    name: 'Bash',
    languages: ['shellscript'],
    install: 'npm install -g bash-language-server',
    command: 'bash-language-server',
    args: ['start'],
    detail: npmDetail,
    docs: 'https://github.com/bash-lsp/bash-language-server',
  },
  {
    name: 'Dockerfile',
    languages: ['dockerfile'],
    install: 'npm install -g dockerfile-language-server-nodejs',
    command: 'docker-langserver',
    args: ['--stdio'],
    detail: npmDetail,
    docs: 'https://github.com/rcjsuen/dockerfile-language-server',
  },
  {
    name: 'Go',
    languages: ['go'],
    install: 'go install golang.org/x/tools/gopls@latest',
    command: 'gopls',
    args: [],
    detail:
      'Requires the Go toolchain. This command installs gopls into your Go bin folder, which BasedCode also checks outside PATH.',
    docs: 'https://go.dev/gopls/',
  },
  {
    name: 'Rust',
    languages: ['rust'],
    install: 'rustup component add rust-analyzer',
    command: 'rust-analyzer',
    args: [],
    detail:
      'Requires rustup. This command installs rust-analyzer for the active toolchain; BasedCode also checks the Cargo bin folder outside PATH.',
    docs: 'https://rust-analyzer.github.io/',
  },
  {
    name: 'C / C++',
    languages: ['c', 'cpp'],
    install: '',
    command: 'clangd',
    args: [],
    detail:
      'Install clangd with LLVM or your package manager and put it on PATH. It reads compile_commands.json or compile_flags.txt to understand your build.',
    docs: 'https://clangd.llvm.org/installation',
  },
  {
    name: 'Java',
    languages: ['java'],
    install: '',
    command: 'jdtls',
    args: [],
    detail:
      'Requires a recent JDK. Install the Eclipse JDT language server and put its jdtls launcher on PATH.',
    docs: 'https://github.com/eclipse-jdtls/eclipse.jdt.ls',
  },
  {
    name: 'Ruby',
    languages: ['ruby'],
    install: 'gem install ruby-lsp',
    command: 'ruby-lsp',
    args: [],
    detail:
      'Requires Ruby. This command installs the ruby-lsp executable; make sure your gem bin folder is on PATH.',
    docs: 'https://shopify.github.io/ruby-lsp/',
  },
  {
    name: 'PHP',
    languages: ['php'],
    install: 'npm install -g intelephense',
    command: 'intelephense',
    args: ['--stdio'],
    detail: 'Requires Node.js and npm. Install it yourself with this command; BasedCode then finds it on PATH.',
    docs: 'https://intelephense.com/',
  },
  {
    name: 'Lua',
    languages: ['lua'],
    install: '',
    command: 'lua-language-server',
    args: [],
    detail: 'Install lua-language-server from its releases page or your package manager and put it on PATH.',
    docs: 'https://luals.github.io/',
  },
];
