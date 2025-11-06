// commands/rank.js — Arabic, with permission check + auto-create

const { SlashCommandBuilder, PermissionFlagsBits } = require("discord.js");
const fs = require("fs");
const { ADMIN_ROLE_ID, CURRENCY_SYMBOL, ranks } = require("../config.json");
const permsMap = require("../permissions.json");

// helpers (local copy so the command can check perms itself)
function hasAnyRoleId(member, ids = []) {
  if (!ids?.length) return false;
  return member.roles.cache.some((r) => ids.includes(r.id));
}
function hasPromotePermission(member) {
  return (
    member.permissions?.has?.(PermissionFlagsBits.Administrator) ||
    member.roles.cache.has(ADMIN_ROLE_ID) ||
    hasAnyRoleId(member, permsMap.promote || [])
  );
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName("rank")
    .setDescription("تعيين رتبة مستخدم (للمشرف)")
    .addUserOption((opt) =>
      opt.setName("user").setDescription("المستخدم المستهدف").setRequired(true)
    )
    .addStringOption((opt) =>
      opt
        .setName("rank")
        .setDescription("اختر الرتبة")
        .addChoices(
          ...ranks.map((r) => ({ name: r, value: r })) // من config.json
        )
        .setRequired(true)
    ),

  async execute(interaction) {
    try {
      if (!hasPromotePermission(interaction.member)) {
        return interaction.reply({
          content: "لا تملك صلاحية استخدام هذا الأمر.",
          ephemeral: true,
        });
      }

      const target = interaction.options.getUser("user");
      const newRank = interaction.options.getString("rank");

      // load users.json
      if (!fs.existsSync("./database/users.json")) fs.writeFileSync("./database/users.json", "{}");
      const users = JSON.parse(fs.readFileSync("./database/users.json", "utf8"));

      // create record automatically if missing
      if (!users[target.id]) {
        users[target.id] = {
          name: target.username,
          age: null,
          birth: null,
          country: null,
          income: 0,
          rank: newRank,
          balance: 0,
          status: "approved", // أنشأناه كحساب معتمد لتسهيل الإدارة
          frozen: false,
        };
      } else {
        users[target.id].rank = newRank;
      }

      fs.writeFileSync("./database/users.json", JSON.stringify(users, null, 2));

      return interaction.reply({
        content: `تم تعيين رتبة <@${target.id}> إلى **${newRank}**.`,
        ephemeral: true,
      });
    } catch (err) {
      console.error("Error in /rank:", err);
      if (!interaction.replied) {
        await interaction.reply({
          content: "حدث خطأ أثناء تنفيذ الأمر.",
          ephemeral: true,
        });
      }
    }
  },
};
