import fs from "fs";

import * as configFile from "../config.json";

export const config: Config = configFile;

export interface Config {
  tokens: {
    user: string;
    bot: string;
  };
  guilds: Array<{
    source: string;
    target: string;
    skipBackfill?: boolean;
  }>;
}

export interface MirrorStorage {
  // Old channel ID -> New channel ID
  channels: Map<string, string>;

  // Old channel ID -> Last backlog message ID
  backlog: Map<string, string>;
}

const getStorage = (): MirrorStorage =>
  fs.existsSync("storage.json")
    ? JSON.parse(fs.readFileSync("storage.json", "utf8"))
    : {
        backlog: {},
        channels: {},
      };

export const storage: MirrorStorage = getStorage();

export const saveStorage = (): void =>
  fs.writeFileSync("storage.json", JSON.stringify(storage));
