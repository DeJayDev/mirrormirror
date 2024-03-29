import { GuildBasedChannel, TextChannel, Webhook } from "discord.js";

export class WebhookManager {
  name: string;
  webhooks: Map<string, Webhook>;

  constructor(name: string) {
    this.name = name;
    this.webhooks = new Map<string, Webhook>();
  }

  async getClient(channel: GuildBasedChannel): Promise<Webhook> {
    if (this.webhooks.has(channel.id)) {
      const webhook = (await (channel as TextChannel).fetchWebhooks()).find(
        (value) => value.name === this.name
      );

      if (webhook === undefined) {
        console.log(
          `[WEBHOOK] ${this.name} webhook not found in ${channel.name}`
        );
        const created = await (channel as TextChannel).createWebhook(
          this.name,
          {
            reason: "Webhook for " + this.name,
          }
        );

        this.webhooks.set(channel.id, created);
        console.log(`[WEBHOOK] Created webhook in ${channel.name}`);
        return created;
      }

      this.webhooks.set(channel.id, webhook);
      console.log(`[WEBHOOK] ${this.name} webhook found in ${channel.name}`);
      return webhook;
    }

    return this.webhooks.get(channel.id)!;
  }

}
