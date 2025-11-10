// commands/reglist.js — طباعة قائمة التسجيلات حسب الحالة
const { SlashCommandBuilder, EmbedBuilder } = require("discord.js");
const fs = require("fs");
const GC = require("../guildConfig");

function loadUsers() {
  if (!fs.existsSync("./database/users.json")) fs.writeFileSync("./database/users.json", "{}");
  return JSON.parse(fs.readFileSync("./database/users.json", "utf8"));
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName("reglist")
    .setDescription("عرض قائمة المستخدمين المسجلين حسب الحالة")
    .addStringOption(o =>
      o.setName("status")
        .setDescription("الحالة المراد عرضها")
        .addChoices(
          { name: "الكل", value: "all" },
          { name: "قيد المراجعة", value: "pending" },
          { name: "مقبول", value: "approved" },
          { name: "مرفوض", value: "rejected" },
          { name: "قائمة سوداء", value: "blacklisted" },
        )
        .setRequired(false)
    )
    .addBooleanOption(o =>
      o.setName("here")
        .setDescription("إرسال القائمة في هذه القناة بدلاً من قناة السجل")
        .setRequired(false)
    ),

  async execute(interaction) {
    const status = interaction.options.getString("status") || "all";
    const postHere = interaction.options.getBoolean("here") || false;

    const users = loadUsers();
    const entries = Object.entries(users);

    const filtered = status === "all"
      ? entries
      : entries.filter(([, u]) => (u.status || "pending") === status);

    if (!filtered.length) {
      return interaction.reply({ content: "لا توجد سجلات مطابقة.", ephemeral: true });
    }

    // Prepare lines (limit 50 per embed)
    const lines = filtered.map(([id, u]) =>
      `• ${u.name || "غير معروف"} — <@${id}> — **${u.status || "pending"}** — رصيد: ${u.balance || 0}`
    );

    const chunks = [];
    while (lines.length) chunks.push(lines.splice(0, 50));

    const embeds = chunks.map((chunk, idx) =>
      new EmbedBuilder()
        .setColor(0x5865F2)
        .setTitle(`قائمة التسجيلات — ${status === "all" ? "الكل" : status} (${filtered.length})`)
        .setDescription(chunk.join("\n"))
        .setFooter({ text: `صفحة ${idx + 1}/${chunks.length}` })
    );

    // Decide destination channel
    const g = GC.get(interaction.guildId);
    const feedId = g.REGISTER_FEED_CHANNEL_ID;
    const feedCh = feedId
      ? (interaction.client.channels.cache.get(feedId) || await interaction.client.channels.fetch(feedId).catch(() => null))
      : null;

    if (!postHere && feedCh) {
      await feedCh.send({ embeds });
      return interaction.reply({ content: `تم إرسال القائمة إلى <#${feedCh.id}>.`, ephemeral: true });
    }

    // send here
    await interaction.reply({ embeds, ephemeral: false });
  },
};
