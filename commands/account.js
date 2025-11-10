// commands/account.js — عرض الحساب البنكي
const { SlashCommandBuilder, EmbedBuilder } = require("discord.js");

module.exports = {
  data: new SlashCommandBuilder()
    .setName("account")
    .setDescription("عرض بيانات حسابك البنكي"),

  async execute(interaction, ctx) {
    try {
      const users = ctx.users();                 // ← استخدم محمل index.js الآمن
      const user  = users[interaction.user.id];

      if (!user) {
        return interaction.reply({
          content: "⚠️ لم يتم العثور على سجل حسابك. الرجاء التسجيل أولًا باستخدام `/register`.",
          flags: 64, // في v14 لا مشكلة من هذا التحذير
        });
      }

      const embed = new EmbedBuilder()
        .setColor(0x0099ff)
        .setTitle("💳 الحساب البنكي")
        .setThumbnail(interaction.user.displayAvatarURL({ size: 256 }))
        .addFields(
          { name: "الاسم", value: String(user.name ?? "غير محدد"), inline: true },
          { name: "العمر", value: String(user.age ?? "—"), inline: true },
          { name: "تاريخ الميلاد", value: String(user.birth ?? "—"), inline: true },
          { name: "الدولة", value: String(user.country ?? "—"), inline: true },
          { name: "الدخل الشهري", value: String(user.income ?? "0"), inline: true },
          { name: "الرتبة", value: String(user.rank ?? "—"), inline: true },
          { name: "الرصيد", value: String(user.balance ?? 0), inline: true },
          { name: "الحالة", value: String(user.status ?? "—"), inline: true },
          { name: "الفصيل", value: String(user.faction ?? "—"), inline: true },
          { name: "معرّف المستخدم", value: String(interaction.user.id), inline: false }
        )
        .setFooter({ text: "🏦 بنك المجتمع" });

      await interaction.reply({ embeds: [embed], flags: 64 });
    } catch (error) {
      console.error("account error:", error);
      if (!interaction.replied) {
        await interaction.reply({
          content: "حدث خطأ أثناء عرض الحساب.",
          flags: 64,
        });
      }
    }
  },
};
