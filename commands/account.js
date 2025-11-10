const { SlashCommandBuilder, EmbedBuilder } = require("discord.js");
const fs = require("fs");

module.exports = {
  data: new SlashCommandBuilder().setName("account").setDescription("عرض بيانات حسابك البنكي"),
  async execute(interaction) {
    if (!fs.existsSync("./database/users.json")) fs.writeFileSync("./database/users.json","{}");
    const users = JSON.parse(fs.readFileSync("./database/users.json","utf8"));
    const u = users[interaction.user.id];
    if (!u) return interaction.reply({ content:"⚠️ لا يوجد حساب. استخدم /register أولًا.", ephemeral:true });

    const e = new EmbedBuilder()
      .setColor(0x0099ff).setTitle("💳 الحساب البنكي")
      .setThumbnail(interaction.user.displayAvatarURL({ size:256 }))
      .addFields(
        { name:"الاسم", value:String(u.name||"—"), inline:true },
        { name:"العمر", value:String(u.age||"—"), inline:true },
        { name:"تاريخ الميلاد", value:String(u.birth||"—"), inline:true },
        { name:"الدولة", value:String(u.country||"—"), inline:true },
        { name:"الدخل الشهري", value:String(u.income||0), inline:true },
        { name:"الرتبة", value:String(u.rank||"—"), inline:true },
        { name:"الرصيد", value:String(u.balance||0), inline:true },
        { name:"الحالة", value:String(u.status||"—"), inline:true },
        { name:"الفصيل", value:String(u.faction||"—"), inline:true }
      );
    await interaction.reply({ embeds:[e], ephemeral:true });
  }
};
