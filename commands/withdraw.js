const { SlashCommandBuilder } = require("discord.js");
const GC = require("../guildConfig");

module.exports = {
  data: new SlashCommandBuilder()
    .setName("withdraw")
    .setDescription("سحب رصيد من حسابك")
    .addIntegerOption(o => o.setName("amount").setDescription("المبلغ").setRequired(true)),

  async execute(interaction, { cfg, users, saveUsers, pushTx }) {
    const g = cfg();
    const uid = interaction.user.id;
    const amount = interaction.options.getInteger("amount");
    const U = users();
    const A = U[uid];
    if (!A) return interaction.reply({ content:"لا يوجد حساب.", flags: 64 });
    if (A.frozen) return interaction.reply({ content:"حسابك مجمد.", flags: 64 });
    if (amount <= 0) return interaction.reply({ content:"المبلغ غير صحيح.", flags: 64 });

    const fee = Math.floor((amount*(g.fees.WITHDRAW_FEE||0))/100);
    const total = amount + fee;
    if ((A.balance||0) < total) return interaction.reply({ content:"رصيد غير كافٍ.", flags: 64 });

    // daily limit
    const key = new Date().toISOString().slice(0,10);
    A._daily = A._daily || {};
    const spent = A._daily[key] || 0;
    if (spent + total > (g.DAILY_WITHDRAW_LIMIT||Infinity))
      return interaction.reply({ content:`تجاوزت حد السحب اليومي (${g.DAILY_WITHDRAW_LIMIT}${g.CURRENCY_SYMBOL}).`, flags: 64 });

    A.balance -= total;
    A._daily[key] = spent + total;
    saveUsers(U, interaction.guild);
    pushTx({ type:"withdraw", from:uid, amount, fee });
    return interaction.reply({ content:`💸 تم سحب ${amount}${g.CURRENCY_SYMBOL} (رسوم ${fee}).`, flags: 64 });
  }
};
