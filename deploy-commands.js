const { REST, Routes, SlashCommandBuilder } = require('discord.js');

const TOKEN = process.env.TOKEN;
const CLIENT_ID = '1479968046117556344';
const GUILD_ID = '1478540552914866208';

const commands = [
  new SlashCommandBuilder()
    .setName('bite')
    .setDescription('Try to infect another member')
    .addUserOption(option =>
      option
        .setName('target')
        .setDescription('The person you want to bite')
        .setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName('cure')
    .setDescription('Try to cure yourself'),

  new SlashCommandBuilder()
    .setName('hide')
    .setDescription('Hide during an outbreak event'),

  new SlashCommandBuilder()
    .setName('raid')
    .setDescription('Join the active boss raid'),

  new SlashCommandBuilder()
    .setName('daily')
    .setDescription('Claim your daily supply crate'),

  new SlashCommandBuilder()
    .setName('hunt')
    .setDescription('Hunt a wandering zombie'),

  new SlashCommandBuilder()
    .setName('scavenge')
    .setDescription('Search a dangerous location for loot')
    .addStringOption(option =>
      option
        .setName('location')
        .setDescription('Choose where to scavenge')
        .setRequired(true)
        .addChoices(
          { name: 'Hospital', value: 'hospital' },
          { name: 'Police Station', value: 'police-station' },
          { name: 'Bunker', value: 'bunker' },
          { name: 'Mall', value: 'mall' }
        )
    ),

  new SlashCommandBuilder()
    .setName('status')
    .setDescription('Check your infection status'),

  new SlashCommandBuilder()
    .setName('leaderboard')
    .setDescription('Show the zombie leaderboard'),

  new SlashCommandBuilder()
    .setName('loot')
    .setDescription('Search for supplies'),

  new SlashCommandBuilder()
    .setName('inventory')
    .setDescription('Check your inventory'),

  new SlashCommandBuilder()
    .setName('use')
    .setDescription('Use an item from your inventory')
    .addStringOption(option =>
      option
        .setName('item')
        .setDescription('The item you want to use')
        .setRequired(true)
        .addChoices(
          { name: 'Cure', value: 'cure' },
          { name: 'Weapon', value: 'weapon' },
          { name: 'Protective Gear', value: 'protective-gear' },
          { name: 'Antivirus', value: 'antivirus' },
          { name: 'Food', value: 'food' },
          { name: 'Medkit', value: 'medkit' },
          { name: 'Biohazard Suit', value: 'biohazard-suit' },
          { name: 'Mutation', value: 'mutation' },
          { name: 'Super Cure', value: 'super-cure' },
          { name: 'Flamethrower', value: 'flamethrower' }
        )
    ),

  new SlashCommandBuilder()
    .setName('serverstats')
    .setDescription('View outbreak statistics')
].map(command => command.toJSON());

const rest = new REST({ version: '10' }).setToken(TOKEN);

(async () => {
  try {
    console.log('Registering slash commands...');

    await rest.put(
      Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID),
      { body: commands }
    );

    console.log('Slash commands registered.');
  } catch (error) {
    console.error(error);
  }
})();