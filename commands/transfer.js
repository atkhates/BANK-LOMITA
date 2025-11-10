const { SlashCommandBuilder, EmbedBuilder } = require("discord.js");
const GC = require("../guildConfig");

module.exports = {
  data: new SlashCommandBuilder()
    .setName("transfer")
    .setDescription("تحويل رصيد إلى مستخدم")
    .addUserOption(o => o.setName("user").setDescription("المستلم").setRequired(true))
    .addIntegerOption(o => o.setName("amount").setDescription("المبلغ").setRequired(true)),

  async execute(interaction, { gconf, users, saveUsers, pushTx, logTransaction }) {
    const g = gconf();
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
    pushTx({ type:"transfer", guildId: interaction.guildId, from, to, amount, fee });

    // Log to transaction channel
    const embed = new EmbedBuilder()
      .setColor(0x3498db)
      .setTitle("💸 تحويل رصيد")
      .addFields(
        { name: "من", value: `<@${from}> (${A.name || "غير معروف"})`, inline: true },
        { name: "إلى", value: `<@${to}> (${B.name || "غير معروف"})`, inline: true },
        { name: "المبلغ", value: `${amount}${g.CURRENCY_SYMBOL}`, inline: true },
        { name: "الرسوم", value: `${fee}${g.CURRENCY_SYMBOL}`, inline: true },
        { name: "الإجمالي", value: `${total}${g.CURRENCY_SYMBOL}`, inline: true },
        { name: "الرصيد المتبقي", value: `${A.balance}${g.CURRENCY_SYMBOL}`, inline: true }
      )
      .setTimestamp();
    
    logTransaction(interaction.guildId, embed);

    return interaction.reply({ content:`تم تحويل ${amount}${g.CURRENCY_SYMBOL} إلى <@${to}> (رسوم ${fee}).`, flags: 64 });
  }
};
