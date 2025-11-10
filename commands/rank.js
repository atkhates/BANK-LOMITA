const { SlashCommandBuilder, PermissionFlagsBits } = require("discord.js");
const fs = require("fs");
const GC = require("../guildConfig");

module.exports = {
  data: new SlashCommandBuilder()
    .setName("rank")
    .setDescription("تعيين رتبة مستخدم (للمشرف)")
    .addUserOption(o => o.setName("user").setDescription("المستخدم").setRequired(true))
    .addStringOption(o => o.setName("rank").setDescription("رتبة").setRequired(true)),

  async execute(interaction) {
    if (!interaction.memberPermissions.has(PermissionFlagsBits.Administrator)) {
      return interaction.reply({ content:"هذا الأمر للمشرف فقط.", ephemeral:true });
    }

    const target = interaction.options.getUser("user");
    const r = interaction.options.getString("rank");

    if (!fs.existsSync("./database/users.json")) fs.writeFileSync("./database/users.json","{}");
    const users = JSON.parse(fs.readFileSync("./database/users.json","utf8"));

    if (!users[target.id]) users[target.id] = {
      name: target.username, country:"", age:null, birth:"", income:0, rank:r, balance:0, status:"approved", frozen:false
    };
    else users[target.id].rank = r;

    fs.writeFileSync("./database/users.json", JSON.stringify(users,null,2));
    return interaction.reply({ content:`تم تعيين رتبة <@${target.id}> إلى **${r}**.`, ephemeral:true });
  }
};
