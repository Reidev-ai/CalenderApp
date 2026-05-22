declare const process: {
  env: Record<string, string | undefined>;
};

declare const console: {
  log: (...args: unknown[]) => void;
  error: (...args: unknown[]) => void;
};

declare const Buffer: {
  from(data: string, encoding?: string): Uint8Array;
  concat(chunks: Uint8Array[]): {
    toString(encoding?: string): string;
  };
};

type ChildProcessWithoutNullStreams = {
  stdin: {
    end(data?: string): void;
  };
  stdout: {
    on(event: "data", listener: (chunk: Uint8Array) => void): void;
  };
  stderr: {
    on(event: "data", listener: (chunk: Uint8Array) => void): void;
  };
  on(event: "error", listener: (error: Error) => void): void;
  on(event: "close", listener: (code: number | null) => void): void;
};

declare module "node:child_process" {
  export function spawn(command: string, args?: string[], options?: { stdio?: string[] }): ChildProcessWithoutNullStreams;
}

declare module "node:path" {
  export function dirname(path: string): string;
  export function extname(path: string): string;
  export function join(...paths: string[]): string;
}

declare module "node:http" {
  export type IncomingMessage = {
    method?: string;
    url?: string;
    headers: Record<string, string | string[] | undefined>;
    [Symbol.asyncIterator](): AsyncIterator<Uint8Array | string>;
  };

  export type ServerResponse = {
    writeHead(status: number, headers?: Record<string, string>): void;
    end(data?: string | Uint8Array): void;
  };

  export function createServer(
    listener: (req: IncomingMessage, res: ServerResponse) => void | Promise<void>,
  ): {
    listen(port: number, callback?: () => void): void;
    listen(port: number, hostname: string, callback?: () => void): void;
  };
}

declare module "node:fs/promises" {
  export function appendFile(path: URL | string, data: string): Promise<void>;
  export function mkdir(path: URL | string, options?: { recursive?: boolean }): Promise<void>;
  export function readFile(path: URL | string, encoding: "utf8"): Promise<string>;
  export function readFile(path: URL | string): Promise<Uint8Array>;
  export function writeFile(path: URL | string, data: string | Uint8Array): Promise<void>;
}

declare module "node:crypto" {
  export function randomUUID(): string;
  export function createHash(algorithm: string): {
    update(data: string): {
      digest(encoding: "hex"): string;
    };
  };
}
