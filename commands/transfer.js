const { SlashCommandBuilder } = require("discord.js");
const GC = require("../guildConfig");

module.exports = {
  data: new SlashCommandBuilder()
    .setName("transfer")
    .setDescription("تحويل رصيد إلى مستخدم")
    .addUserOption(o => o.setName("user").setDescription("المستلم").setRequired(true))
    .addIntegerOption(o => o.setName("amount").setDescription("المبلغ").setRequired(true)),

  async execute(interaction, { cfg, users, saveUsers, pushTx }) {
    const g = cfg();
    const from = interaction.user.id;
    const toUser = interaction.options.getUser("user");
    const to = toUser.id;
    const amount = interaction.options.getInteger("amount");

    const U = users();
    const A = U[from], B = U[to];
    if (!A || !B) return interaction.reply({ content:"يجب أن يملك الطرفان حسابًا.", flags: 64 });
    if (A.frozen) return interaction.reply({ content:"حسابك مجمد.", flags: 64 });
    if (amount <= 0) return interaction.reply({ content:"المبلغ غير صحيح.", flags: 64 });

    const fee = Math.floor((amount*(g.fees.TRANSFER_FEE||0))/100);
    const total = amount + fee;
    if ((A.balance||0) < total) return interaction.reply({ content:"رصيد غير كافٍ.", flags: 64 });

    A.balance -= total;
    B.balance = (B.balance||0) + amount;
    saveUsers(U, interaction.guild);
    pushTx({ type:"transfer", from, to, amount, fee });
    return interaction.reply({ content:`تم تحويل ${amount}${g.CURRENCY_SYMBOL} إلى <@${to}> (رسوم ${fee}).`, flags: 64 });
  }
};
