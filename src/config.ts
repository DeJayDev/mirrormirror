import fs from "fs";

export const config: Config = require("../config.json");

export interface Config {
  tokens: {
    user: string,
    bot: string,
  },
  guilds: {
    source: string,
    target: string,
    skipBackfill?: boolean,
  }[]
}

export interface MirrorStorage {
  // Old channel ID -> New channel ID
  channels: {
    [channelId: string]: string,
  },

  // Old channel ID -> Last backlog message ID
  backlog: {
    [channelId: string]: string,
  }
}

const getStorage = (): MirrorStorage => fs.existsSync("storage.json") ? JSON.parse(fs.readFileSync("storage.json", "utf8")) : {
  backlog: {},
  channels: {},
};

export const storage: MirrorStorage = getStorage();

export const saveStorage = (): void => fs.writeFileSync("storage.json", JSON.stringify(storage));