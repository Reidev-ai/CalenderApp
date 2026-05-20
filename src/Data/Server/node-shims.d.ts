declare const process: {
  env: Record<string, string | undefined>;
};

declare const console: {
  log: (...args: unknown[]) => void;
  error: (...args: unknown[]) => void;
};

declare module "node:http" {
  export type IncomingMessage = {
    method?: string;
    url?: string;
    headers: Record<string, string | string[] | undefined>;
    [Symbol.asyncIterator](): AsyncIterator<Uint8Array | string>;
  };

  export type ServerResponse = {
    writeHead(status: number, headers?: Record<string, string>): void;
    end(data?: string): void;
  };

  export function createServer(
    listener: (req: IncomingMessage, res: ServerResponse) => void | Promise<void>,
  ): {
    listen(port: number, callback?: () => void): void;
    listen(port: number, hostname: string, callback?: () => void): void;
  };
}

declare module "node:fs/promises" {
  export function mkdir(path: URL | string, options?: { recursive?: boolean }): Promise<void>;
  export function readFile(path: URL | string, encoding: "utf8"): Promise<string>;
  export function writeFile(path: URL | string, data: string): Promise<void>;
}

declare module "node:crypto" {
  export function randomUUID(): string;
  export function createHash(algorithm: string): {
    update(data: string): {
      digest(encoding: "hex"): string;
    };
  };
}
