const { SlashCommandBuilder, EmbedBuilder, PermissionFlagsBits } = require("discord.js");
const { restoreUsersFromSheet } = require("../sheets");
const fs = require("fs");
const path = require("path");

module.exports = {
  data: new SlashCommandBuilder()
    .setName("sync")
    .setDescription("مزامنة البيانات من Google Sheets إلى قاعدة البيانات")
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

  async execute(interaction, { pushLog }) {
    await interaction.deferReply({ flags: 64 });

    try {
      const result = await restoreUsersFromSheet();

      if (!result.success) {
        return interaction.editReply({
          content: `❌ فشلت المزامنة: ${result.message || 'خطأ غير معروف'}`,
        });
      }

      if (result.count === 0) {
        return interaction.editReply({
          content: `⚠️ لا توجد بيانات في Google Sheets للمزامنة.`,
        });
      }

      const dbPath = path.join(process.cwd(), "database", "users.json");
      if (!fs.existsSync(path.dirname(dbPath))) {
        fs.mkdirSync(path.dirname(dbPath), { recursive: true });
      }

      fs.writeFileSync(dbPath, JSON.stringify(result.users, null, 2));

      const embed = new EmbedBuilder()
        .setColor(0x3498db)
        .setTitle("🔄 تمت المزامنة بنجاح")
        .setDescription(`تم تحديث قاعدة البيانات من Google Sheets\nعدد المستخدمين: **${result.count}**`)
        .addFields(
          { name: "المصدر", value: "📊 Google Sheets", inline: true },
          { name: "الوجهة", value: "💾 users.json", inline: true },
          { name: "الحالة", value: "✅ محدث", inline: true }
        )
        .setTimestamp()
        .setFooter({ text: "يمكنك الآن التعديل في Google Sheets واستخدام /sync للتحديث" });

      await pushLog(interaction.guildId, `🔄 **مزامنة بيانات** - <@${interaction.user.id}> زامن ${result.count} مستخدم من Google Sheets`);

      return interaction.editReply({ embeds: [embed] });

    } catch (error) {
      console.error('Sync error:', error);
      return interaction.editReply({
        content: `❌ حدث خطأ أثناء المزامنة: ${error.message}`,
      });
    }
  }
};
