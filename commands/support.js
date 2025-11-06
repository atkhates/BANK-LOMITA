const { SlashCommandBuilder, ModalBuilder, TextInputBuilder, TextInputStyle, ActionRowBuilder } = require("discord.js");

module.exports = {
  data: new SlashCommandBuilder().setName("support").setDescription("Contact bank support"),

  async execute(interaction) {
    const modal = new ModalBuilder().setCustomId("supportModal").setTitle("Support Request");
    const subject = new TextInputBuilder().setCustomId("subj").setLabel("Subject").setStyle(TextInputStyle.Short).setRequired(true);
    const body = new TextInputBuilder().setCustomId("body").setLabel("Describe your issue").setStyle(TextInputStyle.Paragraph).setRequired(true);
    modal.addComponents(new ActionRowBuilder().addComponents(subject), new ActionRowBuilder().addComponents(body));
    await interaction.showModal(modal);
  },
};

