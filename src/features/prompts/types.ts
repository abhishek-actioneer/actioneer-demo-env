export interface PromptBuildOutput {
  system?: string;
  user?: string;
  text?: string;
}

export interface PromptModule<TInput = unknown, TOutput = unknown> {
  id: string;
  version: string;
  owner: string;
  description: string;
  inputSchema?: unknown;
  outputSchema?: unknown;
  build(input: TInput): TOutput;
}
