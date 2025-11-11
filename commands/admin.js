const { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require("discord.js");
const GC = require("../guildConfig");
const fs = require("fs");

module.exports = {
  data: new SlashCommandBuilder()
    .setName("admin")
    .setDescription("لوحة تحكم المشرف لإدارة حسابات المستخدمين")
    .addUserOption(o => o.setName("target").setDescription("مستخدم").setRequired(false)),

  async execute(interaction, ctx) {
    if (!interaction.memberPermissions.has("Administrator") && !GC.get(interaction.guildId).ADMIN_ROLE_ID) {
      // we keep it simple; full permission checks happen on button press
    }

    const target = interaction.options.getUser("target") || interaction.user;

    if (!fs.existsSync("./database/users.json")) fs.writeFileSync("./database/users.json","{}");
    const users = JSON.parse(fs.readFileSync("./database/users.json","utf8"));
    const u = users[target.id];

    const g = GC.get(interaction.guildId);
    const data = u || {
      name: target.username, phone:"—", country:"—", age:"—", birth:"—", income:0, rank:g.ranks[0], balance:0, status:"no-record", kind:"—", faction:"—"
    };

    const embed = new EmbedBuilder()
      .setColor(0x2b2d31).setTitle("مراجعة المستخدم").setThumbnail(target.displayAvatarURL({ size:256 }))
      .setDescription(`${target} — \n${target.tag}`)
      .addFields(
        { name:"الاسم", value:String(data.name), inline:true },
        { name:"رقم الهاتف", value:String(data.phone || "—"), inline:true },
        { name:"البلد", value:String(data.country), inline:true },
        { name:"العمر", value:String(data.age), inline:true },
        { name:"تاريخ الميلاد", value:String(data.birth), inline:true },
        { name:"الدخل", value:String(data.income), inline:true },
        { name:"الرتبة", value:String(data.rank), inline:true },
        { name:"الرصيد", value:String(data.balance), inline:true },
        { name:"الحالة", value:String(data.status), inline:true },
        { name:"النوع", value:String(data.kind), inline:true },
        { name:"فصيل", value:String(data.faction || "—"), inline:true },
        { name:"ID", value:target.id, inline:false }
      );

    const rows = [];
    if (u && u.status === "pending") {
      rows.push(new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`approve_${target.id}`).setLabel("موافقة").setStyle(ButtonStyle.Success),
        new ButtonBuilder().setCustomId(`reject_${target.id}`).setLabel("رفض").setStyle(ButtonStyle.Danger)
      ));
    }
    rows.push(new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`addBalance_${target.id}`).setLabel("إضافة رصيد").setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId(`withdraw_${target.id}`).setLabel("سحب").setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId(`promote_${target.id}`).setLabel("ترقية").setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId(`editInfo_${target.id}`).setLabel("تعديل المعلومات").setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId(`editIncome_${target.id}`).setLabel("تعديل الدخل والنوع").setStyle(ButtonStyle.Secondary)
    ));
    rows.push(new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`fees`).setLabel("تعديل الرسوم").setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId(`${u?.frozen ? "unfreeze":"freeze"}_${target.id}`).setLabel(u?.frozen ? "إلغاء تجميد":"تجميد").setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId(`blacklist_${target.id}`).setLabel("قائمة سوداء").setStyle(ButtonStyle.Danger)
    ));

    await interaction.reply({ embeds:[embed], components:rows, flags: 64 });
  }
};
