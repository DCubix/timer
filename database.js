const { Sequelize, DataTypes } = require('sequelize');

const sequelize = new Sequelize({
    dialect: 'sqlite',
    storage: './timer.db'
});

sequelize.authenticate()
    .then(() => {
        console.log('Connection has been established successfully.');
    })
    .catch((error) => {
        console.error('Unable to connect to the database:', error);
    });

const TimerEntry = sequelize.define('TimerEntry', {
    id: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true
    },
    listName: {
        type: DataTypes.STRING,
        allowNull: false
    },
    timeSeconds: {
        type: DataTypes.INTEGER,
        allowNull: false
    },
    description: {
        type: DataTypes.STRING,
        allowNull: false
    },
    createdAt: {
        type: DataTypes.DATE,
        defaultValue: Sequelize.NOW
    },
    order: {
        type: DataTypes.INTEGER,
        defaultValue: 0
    },
    enabled: {
        type: DataTypes.BOOLEAN,
        defaultValue: true
    }
});

TimerEntry.sync({ force: false })
    .then(() => {
        console.log('TimerEntry table created');
    })
    .catch((error) => {
        console.error('Error creating TimerEntry table:', error);
    });

module.exports = {
    sequelize,
    TimerEntry
};
