const { SlashCommandBuilder } = require("discord.js");

module.exports = {
  data: new SlashCommandBuilder()
    .setName("transfer")
    .setDescription("Transfer balance to another user")
    .addUserOption((o) => o.setName("user").setDescription("Recipient user").setRequired(true))
    .addIntegerOption((o) => o.setName("amount").setDescription("Amount to transfer").setRequired(true)),

  async execute(interaction, { cfg, users, saveUsers, pushTx, pushLog }) {
    const C = cfg();
    const from = interaction.user.id;
    const toUser = interaction.options.getUser("user");
    if (toUser.bot) return interaction.reply({ content: "Cannot transfer to a bot.", ephemeral: true });
    const to = toUser.id;
    const amount = interaction.options.getInteger("amount");

    const U = users();
    const A = U[from], B = U[to];
    if (!A || !B) return interaction.reply({ content: "Both users must have accounts.", ephemeral: true });
    if (A.frozen) return interaction.reply({ content: "Your account is frozen. Contact support.", ephemeral: true });
    if (amount <= 0) return interaction.reply({ content: "Amount must be greater than zero.", ephemeral: true });

    const fee = Math.floor((amount * (C.fees.TRANSFER_FEE || 0)) / 100);
    const total = amount + fee;

    if ((A.balance || 0) < total) return interaction.reply({ content: "Insufficient balance.", ephemeral: true });

    // daily withdraw cap (simulate as outgoing limit)
    const todayKey = new Date().toISOString().slice(0, 10);
    A._daily = A._daily || {};
    const spent = A._daily[todayKey] || 0;
    if (spent + total > C.DAILY_WITHDRAW_LIMIT) {
      return interaction.reply({ content: `Daily outgoing limit exceeded (${C.DAILY_WITHDRAW_LIMIT} ${C.CURRENCY_SYMBOL}).`, ephemeral: true });
    }

    // do transfer
    A.balance -= total;
    B.balance = (B.balance || 0) + amount;
    A._daily[todayKey] = spent + total;

    saveUsers(U);
    pushTx({ type: "transfer", from, to, amount, fee });
    await pushLog(interaction.client, { kind: "transfer", actor: from, msg: `Transfer ${amount} + fee ${fee} to ${to}` });

    return interaction.reply({ content: `Transferred ${amount} ${C.CURRENCY_SYMBOL} to <@${to}> (fee: ${fee} ${C.CURRENCY_SYMBOL}).`, ephemeral: true });
  },
};

