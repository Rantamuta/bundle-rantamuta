declare const process: {
  cwd(): string;
  execPath: string;
};

declare const Buffer: {
  from(input: number[]): unknown;
};

declare function describe(name: string, fn: () => void): void;
declare function it(name: string, fn: () => void | Promise<void>): void;

declare module 'assert';
declare module 'fs';
declare module 'os';
declare module 'path';
declare module 'child_process' {
  export function spawnSync(command: string, args: string[], options: { cwd: string; encoding: string }): {
    status: number | null;
    stdout: string;
    stderr: string;
  };
}
declare module 'node:test' {
  const test: (name: string, fn: () => void) => void;
  export = test;
}
declare module 'node:assert/strict';

declare module 'ranvier' {
  export class Account {
    username: string;
    name: string;
    banned?: boolean;
    deleted?: boolean;
    constructor(data: { username: string; characters: string[]; password: string | null; metadata: Record<string, unknown> });
    setPassword(password: string): void;
    checkPassword(password: string): boolean;
    hasCharacter(name: string): boolean;
    addCharacter(name: string): void;
    save(): void;
  }

  export type PlayerInstance = {
    name: string;
    room: RoomInstance | null;
    socket: { writable?: boolean } | null;
    __pruned?: boolean;
    hydrate(state: unknown): void;
  };

  export const Player: new (data: Record<string, unknown>) => PlayerInstance;

  export type RoomInstance = {
    title: string;
    description: string;
  };

  export const Room: new (...args: unknown[]) => RoomInstance;

  export class TransportStream {
    emit(event: string, ...args: unknown[]): void;
    on(event: string, listener: (...args: unknown[]) => void | Promise<void>): void;
  }

  export const Logger: {
    error(message: string): void;
    warn(message: string): void;
    log(message: string): void;
  };

  export const Broadcast: {
    sayAt(target: unknown, message: string): void;
    prompt(target: unknown): void;
  };

  export const Data: {
    exists(kind: string, name: string): boolean;
  };
}

declare module 'ranvier-telnet' {
  export const Sequences: {
    EOR: number;
    IAC: number;
    GA: number;
  };

  export class TelnetSocket {
    gaMode: number;
    readable: boolean;
    writable: boolean;
    socket: { write(data: unknown): void };
    attach(rawSocket: unknown): void;
    on(event: string, listener: (...args: unknown[]) => void): void;
    write(data: unknown, encoding?: string): void;
    end(data?: unknown, encoding?: string): void;
    toggleEcho(): void;
  }

  export class TelnetServer {
    netServer: {
      listen(port: number, cb: () => void): void;
      close(): void;
    };
    constructor(connectionListener: (rawSocket: unknown) => void);
  }
}
