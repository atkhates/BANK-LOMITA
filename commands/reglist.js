const { SlashCommandBuilder } = require("discord.js");

module.exports = {
  data: new SlashCommandBuilder()
    .setName("reglist")
    .setDescription("نشر/تحديث لوحة التسجيلات")
    .addSubcommand(s => s.setName("post").setDescription("نشر اللوحة في القناة المضبوطة")),

  async execute(interaction, { updateRegList }) {
    await updateRegList();
    await interaction.reply({ content:"✅ تم تحديث اللوحة.", ephemeral:true });
  }
};
