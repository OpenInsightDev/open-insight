import { type Sandbox } from "./index.ts";

export type SandboxPromise = {
  $(options: {
    command: string;
    args?: string[];
    env?: Record<string, string>;
    cwd?: string;
  }): Promise<string>;
  readFile(options: Readonly<{ sandboxPath: string }>): Promise<string>;
  writeFile(options: Readonly<{ sandboxPath: string; content: string }>): Promise<void>;
  download(options: Readonly<{ sandboxPath: string; hostPath: string }>): Promise<void>;
  upload(options: Readonly<{ sandboxPath: string; hostPath: string }>): Promise<void>;
  expose(
    options: Readonly<{ sandboxPort: number; hostPort: number }>,
  ): Promise<{ hostUrl: string }>;
};

export const asPromise = (_sandbox: Sandbox): SandboxPromise => {
  throw new Error("Not implemented yet");
};
