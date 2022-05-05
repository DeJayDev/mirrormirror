// @flow

import {Channel, ChannelPosition, Guild, Message, TextChannel, WebhookClient} from "discord.js";
import {saveStorage, storage} from "./config";
import {WebhookManager} from "./webhook";

export class Cloner {
  source: Guild;
  target: Guild;
  webhookManager: WebhookManager;

  constructor(source: Guild, target: Guild, webhookManager: WebhookManager) {
    this.source = source;
    this.target = target;
    this.webhookManager = webhookManager;
  }

  async clone(id: string): Promise<Channel> {
    if (storage.channels[id]) {
      const mapped = storage.channels[id];
      return await this.target.channels.fetch(mapped);
    }

    const channel = await this.source.channels.fetch(id);
    const perms = await channel.permissionsFor(this.source.me);

    if (!perms || !perms.has("VIEW_CHANNEL")) {
      storage.channels[channel.id] = null;
      saveStorage();
      return null;
    }

    const result = await this.target.channels.create(channel.name, {
      type: channel.type === "GUILD_NEWS" ? "GUILD_TEXT" : channel.type,
      topic: channel.topic,
      reason: "Cloned from " + channel.name,
      parent: channel.parent ? await this.getCloned(channel.parent.id) : undefined,
    });

    storage.channels[channel.id] = result.id;
    saveStorage();

    console.log(`[CLONER] Clone of ${channel.type} channel ${channel.name} (${channel.id}) to ${result.name} (${result.id}) complete`);
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

  async getCloned(id: string): Promise<Channel | null> {
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
      console.log(`[CLONER] Purging legacy channel ${channel.name} (${channel.id})`);
      await channel.delete("Purged by cloner");
    }
  }

  async sync() {
    console.log("[SELF BOT] Syncing channels...");
    this.webhookManager.clearWebhooks();

    for (const channel of this.source.channels.cache.values()) {
      if (channel.type === "GUILD_CATEGORY") await this.clone(channel.id);
    }

    for (const channel of this.source.channels.cache.values()) {
      if (channel.type === "GUILD_TEXT") await this.clone(channel.id);
    }

    // Rename channels
    for (const channel of this.source.channels.cache.values()) {
      const mapped = await this.getCloned(channel.id);
      if (!mapped || !mapped.name || !channel.name || mapped.name === channel.name) continue;

      try {
        await mapped.setName(channel.name);
      } catch (e) {
        console.log(`[CLONER] Failed to rename channel ${channel.name} (${channel.id}) to ${mapped.name} (${mapped.id})`);
      }
    }

    console.log("[SELF BOT] Reordering channels...")
    await this.reorder();

    // Backlog
    for (const channel of this.source.channels.cache.values()) {
      if (channel.type === "GUILD_TEXT" || channel.type === "GUILD_NEWS") {
        setImmediate(async () => await this.backlog(channel));
      }
    }
  }

  async backlog(channel: TextChannel) {
    // Oldest to newest
    try {
      const perms = await channel.permissionsFor(this.source.me);
      if (!perms || !perms.has("VIEW_CHANNEL")) {
        return;
      }

      const lastId = storage.backlog[channel.id];
      const lastMessage = await channel.messages.fetch(lastId);

      const messages = (await channel.messages.fetch({limit: 50}))
          .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());

      console.log(`[CLONER] Backlogging ${messages.size} in ${channel.name} (${channel.id})`);
      for (const message of messages.values()) {
        if (lastMessage && lastMessage.createdAt && lastMessage.createdAt.getTime() >= message.createdAt.getTime()) continue;
        await this.cloneMessage(message, false);
      }

      console.log(`[CLONER] Backlogged ${messages.size} in ${channel.name} (${channel.id})`);
    } catch (e) {
      console.error(`[CLONER] Failed to fetch backlog for ${channel.name} (${channel.id})`, e);
    }
  }

  async cloneMessage(message: Message, mentions = true) {
    const channel: TextChannel = await this.getCloned(message.channel.id);
    const webhook: WebhookClient = await this.webhookManager.getClient(channel);
    if (!channel) return;

    storage.backlog[channel.id] = message.id;
    saveStorage();

    let content = "";
    if (message.reference) {
      try {
        const referencedChannel = await message.guild.channels.fetch(message.reference.channelId);
        const reference = await referencedChannel.messages.fetch(message.reference.messageId);
        if (reference) {
          content += `> ${reference.content.split("\n").join("\n> ")}\n> Reply from ${reference.author}\n`;
        }
      } catch (e) {
        console.error(`[CLONER] Failed to fetch reference message for ${message.id}`, e);
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

    const contentSplit = content.match(/[\s\S]{1,2000}/g) || [];
    for (let i = 0; i < contentSplit.length; i++) {
      const content = contentSplit[i];
      const final = i === contentSplit.length - 1;

      await webhook.send({
        content,
        username: message.author.username,
        avatarURL: message.author.avatarURL(),
        embeds: final ? message.embeds : undefined,
        attachments: final ? message.attachments.map(a => ({
          id: a.id,
          name: a.name,
          attachment: a.attachment,
          spoiler: a.spoiler,
        })) : undefined,
        allowedMentions: {
          parse: mentions ? ["users", "roles", "everyone"] : [],
        }
      });
    }
  }
}