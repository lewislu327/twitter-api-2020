'use strict'
module.exports = (sequelize, DataTypes) => {
  const Followship = sequelize.define(
    'Followship',
    {
      id: {
        allowNull: false,
        autoIncrement: true,
        primaryKey: true,
        type: DataTypes.INTEGER
      },
      followerId: DataTypes.INTEGER,
      followingId: DataTypes.INTEGER
    },
    {}
  )
  Followship.associate = function (models) {}
  return Followship
}
