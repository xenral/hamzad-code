// Upstream's sentences that this build says in its own words, beyond its name.
//
// The transform in brand-transform.ts applies these where upstream's text is, as it does the name,
// so no upstream file is edited for them. Each is bound to the one file it is in. `whole` means the
// text is the entire string or the entire text of an element; otherwise it is a part of one.
// A fork test checks that every one still finds its text, so a merge that rewords upstream's
// sentence fails there instead of quietly bringing upstream's words back.

export type Phrase = {
  /** The source file, from the repository's root, without its extension. */
  readonly file: string
  readonly from: string
  readonly to: string
  readonly whole?: boolean
}

const tui = (file: string) => `packages/tui/src/${file}`

export const phrases: readonly Phrase[] = [
  // The prompt asks for work, in the voice of the one doing it.
  { file: tui("component/prompt/index"), from: 'Ask anything… "', to: 'Tell Hamzad what to do… "' },
  { file: tui("routes/home"), from: "Fix a TODO in the codebase", to: "Fix the failing test", whole: true },
  {
    file: tui("routes/home"),
    from: "What is the tech stack of this project?",
    to: "Add input validation",
    whole: true,
  },
  { file: tui("routes/home"), from: "Fix broken tests", to: "Write tests for the parser", whole: true },
  {
    file: tui("mini/footer.prompt"),
    from: "Ask anything, / for commands, @ for context",
    to: "Tell Hamzad what to do, / for commands, @ for files",
  },
  { file: tui("feature-plugins/prompt/btw"), from: "Ask anything", to: "Ask Hamzad a side question", whole: true },

  // Code and Plan are the two ways of working, so the hint and the lists call them modes.
  { file: tui("feature-plugins/prompt/footer"), from: "agents", to: "mode", whole: true },
  { file: tui("app"), from: "Switch agent", to: "Switch mode", whole: true },
  { file: tui("app"), from: "Agent cycle", to: "Next mode", whole: true },
  { file: tui("app"), from: "Agent cycle reverse", to: "Previous mode", whole: true },
  { file: tui("config/keybind"), from: "List agents", to: "List modes", whole: true },
  { file: tui("config/keybind"), from: "Next agent", to: "Next mode", whole: true },
  { file: tui("config/keybind"), from: "Previous agent", to: "Previous mode", whole: true },
  { file: tui("config/v1/keybind"), from: "List agents", to: "List modes", whole: true },
  { file: tui("config/v1/keybind"), from: "Next agent", to: "Next mode", whole: true },
  { file: tui("config/v1/keybind"), from: "Previous agent", to: "Previous mode", whole: true },
  { file: tui("component/dialog-agent"), from: "Select agent", to: "Select mode", whole: true },
  { file: tui("component/dialog-agent"), from: "Search agents", to: "Search modes", whole: true },
  { file: tui("routes/session/index"), from: "Switched agent from ", to: "Switched mode from " },
  { file: tui("routes/session/index"), from: "Switched agent to ", to: "Switched mode to " },
  { file: tui("mini/footer.command"), from: "Switch agent", to: "Switch mode", whole: true },
  { file: tui("mini/footer.command"), from: "Select agent", to: "Select mode", whole: true },
  { file: tui("mini/footer.command"), from: "No agents found", to: "No modes found", whole: true },
  {
    file: "packages/core/src/plugin/agent",
    from: "The default agent. Executes tools based on configured permissions.",
    to: "Writes and changes code and runs commands, within the permissions you set.",
    whole: true,
  },
  {
    file: "packages/core/src/plugin/plan",
    from: "Read-only agent for exploring the codebase and planning work before implementation.",
    to: "Reads the code and plans the work, and changes nothing.",
    whole: true,
  },

  // Signed out, the sidebar offered free models and seventy-five providers, neither of which this
  // build has.
  {
    file: tui("feature-plugins/sidebar/footer"),
    from: "OpenCode includes free models so you can start immediately.",
    to: "Sign in once by approving this device in your Hamzad panel.",
    whole: true,
  },
  {
    file: tui("feature-plugins/sidebar/footer"),
    from: "Connect from 75+ providers to use other models, including Claude, GPT, Gemini etc",
    to: "Claude, GPT, Gemini and more, paid per token from your credits.",
    whole: true,
  },
  { file: tui("feature-plugins/sidebar/footer"), from: "Connect provider", to: "Sign in", whole: true },
  // The model list of the new-designs experiment, signed out: the models are not free here.
  { file: tui("component/dialog-model-free"), from: "Free models", to: "Models", whole: true },
  {
    file: tui("component/dialog-model-free"),
    from: "Connect a provider for access to more models",
    to: "Sign in to use them: hamzad auth login",
    whole: true,
  },
  { file: tui("component/dialog-model-free"), from: "connect provider", to: "sign in", whole: true },
]
