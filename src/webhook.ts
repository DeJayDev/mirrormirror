import { GuildBasedChannel, TextChannel, Webhook } from "discord.js";

export class WebhookManager {
  name: string;
  webhooks: Record<string, Webhook>;

  constructor(name: string) {
    this.name = name;
    this.webhooks = {};
  }

  async getClient(channel: GuildBasedChannel): Promise<Webhook> {
    if (!this.webhooks[channel.id]) {
      const webhook = (await (channel as TextChannel).fetchWebhooks()).find(value => value.name === this.name);

      if (webhook) {
        this.webhooks[channel.id] = webhook;
        console.log(`[WEBHOOK] ${this.name} webhook found in ${channel.name}`);
        return webhook;
      } else {
        console.log(`[WEBHOOK] ${this.name} webhook not found in ${channel.name}`);
        const created = await (channel as TextChannel).createWebhook(this.name, {
          reason: "Webhook for " + this.name
        });

        this.webhooks[channel.id] = created;
        console.log(`[WEBHOOK] Created webhook in ${channel.name}`);
        return created;
      }
    }

    return this.webhooks[channel.id];
  }

  clearWebhooks() {
    this.webhooks = {};
  }
}