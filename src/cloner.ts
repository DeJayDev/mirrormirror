import { ChannelPosition, Constants, Guild as BotGuild, GuildBasedChannel, GuildTextBasedChannel, Webhook } from "discord.js";
import { Guild as SelfGuild, GuildTextBasedChannel as SelfGuildTextBasedChannel, Message as SelfMessage, TextChannel } from "discord.js-selfbot-v13";
import { saveStorage, storage } from "./config";
import { WebhookManager } from "./webhook";

export class Cloner {
  source: SelfGuild;
  target: BotGuild;
  webhookManager: WebhookManager;
  skipBackfill: boolean;

  constructor(source: SelfGuild, target: BotGuild, webhookManager: WebhookManager, skipBackfill: boolean) {
    this.source = source;
    this.target = target;
    this.webhookManager = webhookManager;
    this.skipBackfill = skipBackfill || false;
  }

  async clone(id: string): Promise<GuildBasedChannel> {
    if (storage.channels[id]) {
      const mapped = storage.channels[id];
      return await this.target.channels.fetch(mapped);
    } 

    const channel = await this.source.channels.fetch(id);
    const perms = channel.permissionsFor(this.source.me);

    if (!perms || !perms.has("VIEW_CHANNEL")) {
      storage.channels[channel.id] = null;
      saveStorage();
      return null;
    }

    const FORCED_TYPES = [0, 2, 4, 6, 13, 14, 15]
    if (!FORCED_TYPES.includes(Constants.ChannelTypes[channel.type])) {
        console.log(`[CLONER] Skipping ${channel.type} channel ${channel.name} (${channel.id}) in ${this.source.name}`);
        storage.channels[channel.id] = null;
        saveStorage();
        return null;
    }

    const result = await this.target.channels.create(channel.name, {
        type: (channel.toJSON() as any).type,
        topic: channel.type === 'GUILD_TEXT' ? (channel as TextChannel).topic : undefined,
        reason: "Cloned from " + channel.name,
        parent: channel.parent ? (await this.getCloned(channel.parent.id)).id : undefined,
        position: channel.type === ('GUILD_TEXT' || 'GUILD_CATEGORY') ? (channel as TextChannel).position : undefined
    });

    storage.channels[channel.id] = result.id;
    saveStorage();

    console.log(`[CLONER] Clone of ${channel.type} channel ${channel.name} (${channel.id}) in ${this.source.name} to ${result.name} (${result.id}) in ${this.target.name} complete`);
    return result;
  }

  async reorder() {
    const channels = await this.source.channels.fetch();
    const targetChannels = await this.target.channels.fetch();

    let positions: ChannelPosition[] = [];
    for (const channel of channels.values()) {
      const mappedId = storage.channels[channel.id];
      if (!mappedId) continue;

      const targetChannel = targetChannels.get(mappedId);
      positions.push({
        channel: targetChannel,
        position: channel.position,
      });
    }

    await this.target.channels.setPositions(positions);
  }

  async getCloned(id: string): Promise<GuildBasedChannel | null> {
    const mapped = storage.channels[id];
    if (!mapped) {
      return this.clone(id);
    }

    return this.target.channels.fetch(mapped);
  }

  async purgeLegacy() {
    // Hacky and terrible
    const channels = JSON.parse(JSON.stringify(this.target)).channels;

    for (const id of channels) {
      const stored = Object.values(storage.channels).includes(id);
      if (stored) continue;

      const channel = await this.target.channels.fetch(id);
      console.log(`[CLONER] Purging legacy channel ${channel.name} (${channel.id}) in ${this.target.name}`);
      await channel.delete("Purged by cloner");
    }
  }

  async sync() {
    console.log(`[SELF BOT] Syncing channels for ${this.target.name}...`);
    this.webhookManager.clearWebhooks();
    console.log(`[SELF BOT] Cleared webhooks in ${this.target.name}...`);

    // We are running this loop twice to ensure that categories are created before channels.
    for (const channel of this.source.channels.cache.values()) {
      if (channel.type === "GUILD_CATEGORY") await this.clone(channel.id);
    }

    for (const channel of this.source.channels.cache.values()) {
      if (channel.type === "GUILD_TEXT") await this.clone(channel.id);
    }

    // Rename channels
    console.log(`[SELF BOT] Renaming channels in ${this.target.name}...`);
    for (const channel of this.source.channels.cache.values()) {
      const mapped = await this.getCloned(channel.id);
      if (!mapped || !mapped.name || !channel.name || mapped.name === channel.name) continue;

      try {
        await mapped.setName(channel.name);
      } catch (e) {
        console.log(`[CLONER] Failed to rename channel ${channel.name} (${channel.id}) to ${mapped.name} (${mapped.id}) in ${this.target.name}...`);
      }
    }

    console.log(`[SELF BOT] Reordering channels in ${this.target.name}...`)
    await this.reorder();

    // Backlog
    if (this.source.channels.cache.size > 50) {
        console.log(`[SELF BOT] Skipping backlog for ${this.target.name} due to large channel count`);
        return;
    }

    if (this.skipBackfill) {
        // We don't want to log, because ideally the user knows they've disabled backfilling.
        return;
    }

    for (const channel of this.source.channels.cache.values()) {
      if (channel.type === "GUILD_TEXT" || channel.type === "GUILD_NEWS") {
        setImmediate(async () => await this.backlog(channel));
      }
    }
  }

  async backlog(channel: SelfGuildTextBasedChannel) {
    // Oldest to newest
    try {
      const perms = channel.permissionsFor(this.source.me);
      if (!perms || !perms.has("VIEW_CHANNEL")) {
        return;
      }

      const lastId = storage.backlog[channel.id];
      const lastMessage = await channel.messages.fetch(lastId);

      const messages = (await channel.messages.fetch({limit: 50}))
          .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());

      console.log(`[CLONER] Backlogging ${messages.size} for ${channel.name} (${channel.id}) in ${channel.guild.name}...`);
      for (const message of messages.values()) {
        if (lastMessage && lastMessage.createdAt && lastMessage.createdAt.getTime() >= message.createdAt.getTime()) continue;
        await this.cloneMessage(message, false);
      }

      console.log(`[CLONER] Backlogged ${messages.size} for ${channel.name} (${channel.id}) in ${channel.guild.name}...`);
    } catch (e) {
      console.error(`[CLONER] Failed to fetch backlog for ${channel.name} (${channel.id}) in ${channel.guild.name}...`, e);
    }
  }

  async cloneMessage(message: SelfMessage, mentions = true) {
    const channel: GuildTextBasedChannel = (await this.getCloned(message.channel.id)) as GuildTextBasedChannel;
    const webhook: Webhook = await this.webhookManager.getClient(channel);
    if (!channel) return;

    storage.backlog[channel.id] = message.id;
    saveStorage();

    let content = "";
    if (message.reference) {
      try {
        const referencedChannel = await message.guild.channels.fetch(message.reference.channelId);
        const reference = await (referencedChannel as SelfGuildTextBasedChannel).messages.fetch(message.reference.messageId);
        if (reference) {
          content += `> ${reference.content.split("\n").join("\n> ")}\n> Reply from ${reference.author}\n`;
        }
      } catch (e) {
        console.error(`[CLONER] Failed to fetch reference message for ${message.id} in ${message.guild.name}`, e);
      }
    }

    content += message.content;

    message.mentions.members.forEach(member => {
      content = content
          .replace(`<@${member.id}>`, `@${member.user.username}`)
          .replace(`<@!${member.id}>`, `@${member.user.username}`);
    });

    message.mentions.users.forEach(user => {
      content = content
          .replace(`<@${user.id}>`, `@${user.username}`)
          .replace(`<@!${user.id}>`, `@${user.username}`);
    });

    message.mentions.roles.forEach(role => {
      content = content.replace(`<@&${role.id}>`, `@${role.name}`);
    });

    message.mentions.channels.forEach(channel => {
      if (channel.type === "DM") return;
      if (!channel.name) return;

      const mappedId = storage.channels[channel.id];
      if (mappedId) {
        content = content.replace(`<#${channel.id}>`, `<#${mappedId}>`);
      } else {
        content = content.replace(`<#${channel.id}>`, `#${channel.name}`);
      }
    });

    content = content.trim();
    if (!content.length && !message.attachments.size && !message.embeds.length) return;

    await webhook.send({
      content: content.length > 2000 ? content.slice(0, 1995) + '[...]' : content.length ? content : undefined,
      username: message.author.username,
      avatarURL: message.author.avatarURL(),
      embeds: message.embeds ? message.embeds : undefined,
      files: message.attachments ? message.attachments.map(a => a.url) : undefined,
      allowedMentions: {
        parse: mentions ? ["users", "roles", "everyone"] : [],
      }
    });
  }
}