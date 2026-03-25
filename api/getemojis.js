const path = require('path');
const dotenv = require('dotenv');
const { Client, GatewayIntentBits } = require('discord.js');

dotenv.config({ path: path.resolve(__dirname, '.env') });

const token = String(process.env.TOKEN || '').trim();
if (!token) {
    console.error('TOKEN environment variable is required for api/getemojis.js');
    process.exit(1);
}

const client = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildEmojisAndStickers] });

client.once('ready', async () => {
    const guild = await client.guilds.fetch('1471242450386550835').catch(console.error);
    if (guild) {
        console.log('Guild Emojis:');
        guild.emojis.cache.forEach(e => {
            console.log(e.name + ':' + e.id);
        });
    } else {
        console.log('Guild not found');
    }
    process.exit(0);
});

client.login(token).catch((err) => {
    console.error(`Discord login failed: ${String(err?.message || err || 'unknown_error')}`);
    process.exit(1);
});
