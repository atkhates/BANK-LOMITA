const { SlashCommandBuilder, EmbedBuilder, PermissionFlagsBits } = require("discord.js");
const { restoreUsersFromSheet } = require("../sheets");
const fs = require("fs");
const path = require("path");

module.exports = {
  data: new SlashCommandBuilder()
    .setName("restore")
    .setDescription("استعادة جميع المستخدمين من Google Sheets")
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

  async execute(interaction, { saveUsers, pushLog }) {
    await interaction.deferReply({ flags: 64 });

    try {
      const result = await restoreUsersFromSheet();

      if (!result.success) {
        return interaction.editReply({
          content: `❌ فشلت الاستعادة: ${result.message || 'خطأ غير معروف'}`,
        });
      }

      if (result.count === 0) {
        return interaction.editReply({
          content: `⚠️ لا توجد بيانات مستخدمين في Google Sheets للاستعادة.`,
        });
      }

      const dbPath = path.join(process.cwd(), "database", "users.json");
      if (!fs.existsSync(path.dirname(dbPath))) {
        fs.mkdirSync(path.dirname(dbPath), { recursive: true });
      }

      fs.writeFileSync(dbPath, JSON.stringify(result.users, null, 2));

      const embed = new EmbedBuilder()
        .setColor(0x2ecc71)
        .setTitle("✅ تمت الاستعادة بنجاح")
        .setDescription(`تم استعادة **${result.count}** مستخدم من Google Sheets`)
        .addFields(
          { name: "المصدر", value: "Google Sheets (Users tab)", inline: true },
          { name: "الوجهة", value: "database/users.json", inline: true },
          { name: "عدد المستخدمين", value: String(result.count), inline: true }
        )
        .setTimestamp()
        .setFooter({ text: "جميع بيانات المستخدمين محدثة الآن" });

      await pushLog(interaction.guildId, `📥 **استعادة بيانات** - <@${interaction.user.id}> استعاد ${result.count} مستخدم من Google Sheets`);

      return interaction.editReply({ embeds: [embed] });

    } catch (error) {
      console.error('Restore error:', error);
      return interaction.editReply({
        content: `❌ حدث خطأ أثناء الاستعادة: ${error.message}`,
      });
    }
  }
};
