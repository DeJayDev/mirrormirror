import {TextChannel, WebhookClient} from "discord.js";

export class WebhookManager {
  name: string;
  webhooks: Record<string, WebhookClient>;

  constructor(name: string) {
    this.name = name;
    this.webhooks = {};
  }

  async getClient(channel: TextChannel): Promise<WebhookClient> {
    if (!this.webhooks[channel.id]) {
      const webhook = (await channel.fetchWebhooks()).find(value => value.name === this.name);

      if (webhook) {
        this.webhooks[channel.id] = webhook;
        console.log(`[WEBHOOK] ${this.name} webhook found in ${channel.name}`);
        return webhook;
      } else {
        console.log(`[WEBHOOK] ${this.name} webhook not found in ${channel.name}`);
        const created = await channel.createWebhook(this.name, {
          reason: "Webhook for " + this.name
        });

        this.webhooks[channel.id] = created;
        console.log(`[WEBHOOK] Created webhook ${JSON.stringify(created)} in ${channel.name}`);
        return created;
      }
    }

    return this.webhooks[channel.id];
  }

  clearWebhooks() {
    this.webhooks = {};
  }
}