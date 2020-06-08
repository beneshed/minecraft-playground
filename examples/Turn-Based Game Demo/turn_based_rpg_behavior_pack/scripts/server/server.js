const aServerSystem = server.registerSystem(0, 0);

// Global variables
let globalVars = {};

const TurnOrderState = Object.freeze({ inactive: 0, active: 1, fainted: 2 });
const AbilityType = Object.freeze({ none: 0, damageSingleTarget: 1, damageWholeTeam: 2, healSingleTarget: 3 });

// Game state tracking
globalVars.needFirstSetup = false;
globalVars.setupGame = false;
globalVars.gameRunning = false;

// Team tracking
globalVars.playerTeamArray = [];
globalVars.aiTeamArray = [];

// Turn order tracking
globalVars.turnOrderArray = [];
globalVars.currentTurnOrderIndex = 0;

// AI delay
globalVars.aiTurnDelayCounter = 0;
globalVars.aiTurnDelay = 15;

// Player targeting
globalVars.abilitySelected = AbilityType.none;
globalVars.targetedFighter = null;
globalVars.lastFighterHoveredOver = null;

// A query to get all entities loaded in the world
globalVars.queryAllEntities = null;

// An array of entities that died this turn and need to be deleted next frame
globalVars.deadEntities = [];

// Register script only components and listen for events
aServerSystem.initialize = function () {
    // Register a script only component to help track and update the turn order UI. This component will be added to the fighters we create later.
    this.registerComponent("rpg_game:turn_order", { order: 0, turn_order_state: 0, image_name: "" });

    // Setup callbacks for input events
    this.listenForEvent("rpg_game:update_hovered_target", eventData => this.onTargetHovered(eventData));
    this.listenForEvent("rpg_game:click", eventData => this.onClick(eventData));

    // Setup callback for the ability button click event from the client script.
    this.listenForEvent("rpg_game:ability_clicked", abilityClicked => this.onAbilityClicked(abilityClicked));

    // Setup callback for the start game event sent from the client script.
    this.listenForEvent("rpg_game:start", eventData => this.onStartGame(eventData));

    // Setup callback for the leave game event sent from the client script.
    this.listenForEvent("rpg_game:leave", eventData => this.onLeaveGame(eventData));

    // Setup callback for the entity death event when one of the fighters is killed.
    this.listenForEvent("minecraft:entity_death", eventData => this.onEntityDeath(eventData));

    // Setup callback for when our client script has been notified that the player has loaded into the world.
    this.listenForEvent("rpg_game:client_entered_world", eventData => this.onClientEnteredWorld(eventData));

    // Register a query to get all loaded entities in the world
    globalVars.queryAllEntities = this.registerQuery();

    this.registerEventData("rpg_game:update_turn_order", { order: -1, turn_order_state: TurnOrderState.inactive, image_name: "" });
    this.registerEventData("rpg_game:execute_on_hit_animation", { fighter: null });
    this.registerEventData("rpg_game:victory", {});
    this.registerEventData("rpg_game:loss", {});
};

// Keep track of the last fighter the player placed their cursor over
aServerSystem.onTargetHovered = function (eventData) {
    // Remove the target indicator from the last target and add it to the newest hovered fighter
    this.updateTargetIndicator(globalVars.lastFighterHoveredOver, eventData.data.entity);
    globalVars.lastFighterHoveredOver = eventData.data.entity;
};

// Update is called every tick
aServerSystem.update = function () {
    // Clear world
    if (globalVars.needFirstSetup === true) {
        this.clearWorld();
        globalVars.needFirstSetup = false;
    }
    // Only setup the level once the client has told us to.
    if (globalVars.setupGame === true) {
        this.setupWorldForGame();
    }

    // Don't run the game update until everything is setup.
    if (globalVars.gameRunning === true) {
        this.gameUpdate();
    }
};

aServerSystem.gameUpdate = function () {
    // Clean up any dead entities
    this.handleDeadEntities(globalVars.deadEntities);

    // Handle the players turn
    if (this.isPlayersTurn()) {
        // Check if the player has selected an ability and a target fighter
        if (this.isValidAbilityType(globalVars.abilitySelected) && this.isValidTarget(globalVars.targetedFighter) === true) {
            // Use the ability
            this.handlePlayerAbility(globalVars.targetedFighter, globalVars.abilitySelected);
        }
    }
    // Handle the AI turn
    else {
        // Delay running the AI turn for a little bit so the AI turn doesn't instantly happen
        if (globalVars.aiTurnDelayCounter < globalVars.aiTurnDelay) {
            globalVars.aiTurnDelayCounter++;
        }
        else {
            // Choose a random ability and target to attack
            this.handleAIAbility();
            // Reset delay counter
            globalVars.aiTurnDelayCounter = 0;
        }
    }

    // Check if either side has won
    this.checkForVictory();
};

// Clear out all entities, reset the battlefield, and reset flags for the next run
aServerSystem.clearWorld = function () {
    // Remove all loaded entities except the player
    let allEntities = this.getEntitiesFromQuery(globalVars.queryAllEntities);
    let size = allEntities.length;
    for (let index = 0; index < size; ++index) {
        if (allEntities[index].__identifier__ === "minecraft:player") {
            continue;
        }
        this.destroyEntity(allEntities[index]);
    }

    // Setup the fighting arena
    // Front and back walls
    this.executeCommand("/fill -35 3 35 35 8 36 iron_bars", (commandData) => this.commandCallback(commandData) );
    this.executeCommand("/fill -35 3 -26 35 8 -25 iron_bars", (commandData) => this.commandCallback(commandData) );
    // Side walls
    this.executeCommand("/fill -35 3 -25 -36 8 35 iron_bars", (commandData) => this.commandCallback(commandData) );
    this.executeCommand("/fill 35 3 -25 36 8 35 iron_bars", (commandData) => this.commandCallback(commandData) );
    // Lava moat
    this.executeCommand("/fill -35 3 -25 35 3 35 flowing_lava", (commandData) => this.commandCallback(commandData) );
    // Platform made of soul sand that has had its texture replaced with smoot granite.
    // Fighters standing on soul sand will sink a little bit into it.
    this.executeCommand("/fill -14 3 -4 14 3 14 soul_sand", (commandData) => this.commandCallback(commandData) );
};

aServerSystem.setupWorldForGame = function () {
    // Clean up any dead entities
    this.handleDeadEntities(globalVars.deadEntities);
    
    // Setup some rules for the world
    this.executeCommand("/gamerule doMobLoot false", (commandData) => this.commandCallback(commandData) );
    this.executeCommand("/gamerule doMobSpawning false", (commandData) => this.commandCallback(commandData) );
    this.executeCommand("/gamerule doWeatherCycle false", (commandData) => this.commandCallback(commandData) );
    this.executeCommand("/gamerule doDaylightCycle false", (commandData) => this.commandCallback(commandData) );
    // Remove all entities
    let allEntities = this.getEntitiesFromQuery(globalVars.queryAllEntities);
    let size = allEntities.length;
    for (let index = 0; index < size; ++index) {
        if (allEntities[index].__identifier__ === "minecraft:player") {
            continue;
        }
        this.destroyEntity(allEntities[index]);
    }
    
    // Move player to an observable position
    this.executeCommand("/fill -6 0 -4 -6 7 -4 barrier", (commandData) => this.commandCallback(commandData) );
    this.executeCommand("/tp @a -5.87 8 -4.0 -28 40", (commandData) => this.commandCallback(commandData) );
    this.executeCommand("/clear @p", (commandData) => this.commandCallback(commandData));

    // Reset the player and AI teams
    globalVars.playerTeamArray.length = 0;
    globalVars.aiTeamArray.length = 0;

    // Create some fighters for the player
    this.createFighter("minecraft:evocation_illager", 7.5, 5, 0.5, 0, 0, globalVars.playerTeamArray, "Evoker_Head.png");
    this.createFighter("minecraft:vindicator", 0.5, 5, 0.5, 0, 0, globalVars.playerTeamArray, "Vindicator_Head.png");
    this.createFighter("minecraft:llama", -6.5, 5, 0.5, 0, 0, globalVars.playerTeamArray, "Llama_Head.png");

    // Create some fighters for the AI
    this.createFighter("minecraft:blaze", 7.5, 5, 10.5, 0, 180, globalVars.aiTeamArray, "Blaze_Face.png");
    this.createFighter("minecraft:ocelot", 0.5, 5, 10.5, 0, 180, globalVars.aiTeamArray, "OcelotFace.png");
    this.createFighter("minecraft:skeleton", -6.5, 5, 10.5, 0, 180, globalVars.aiTeamArray, "SkeletonFace.png");

    // Initialize the turnOrder array with the fighters from both teams
    globalVars.turnOrderArray = globalVars.aiTeamArray.concat(globalVars.playerTeamArray);

    // Randomize the turn order
    shuffle(globalVars.turnOrderArray);

    // Go through the randomized turn order 
    for (let i = 0; i < globalVars.turnOrderArray.length; i++) {
        let fighter = globalVars.turnOrderArray[i];
        // Get the turn order component for the fighter
        let turnOrderComponent = this.getComponent(fighter, "rpg_game:turn_order");
        // Set the turn order
        turnOrderComponent.data.order = i;
        // Apply the changes to the component
        this.applyComponentChanges(fighter, turnOrderComponent);

        // Put all the turn order information into an object to send to the client script
        let turnOrderEventData = this.createEventData("rpg_game:update_turn_order");
        // The fighters turn order
        turnOrderEventData.data.order = i;
        // The fighters current turn state
        turnOrderEventData.data.turn_order_state = TurnOrderState.inactive;
        // The image to display in the UI. image_name was set when the fighter was created.
        turnOrderEventData.data.image_name = turnOrderComponent.data.image_name;
        // Send the event to the client
        this.broadcastEvent("rpg_game:update_turn_order", turnOrderEventData);
    }

    // Reset the current turn index
    globalVars.currentTurnOrderIndex = -1;
    // Update which fighter is currently active
    this.updateTurnOrder();
    // Update the UI to show which fighter is active
    this.updateIndicatorPosition();

    // Done setting up the game. Allow game update to happen.
    globalVars.setupGame = false;
    globalVars.gameRunning = true;
};

aServerSystem.createFighter = function (identifier, posX, posY, posZ, rotX, rotY, team, image_name) {
    // Get an empty entity handle from the script engine. We'll add components to this to turn it into a fighter.
    let fighter = this.createEntity("entity", identifier);

    // Add a position component
    let posComponent = this.createComponent(fighter, "minecraft:position");
    // Set the position
    posComponent.data.x = posX;
    posComponent.data.y = posY;
    posComponent.data.z = posZ;
    // Apply the changes to the position component
    this.applyComponentChanges(fighter, posComponent);

    // Add a rotation component
    let rotComponent = this.createComponent(fighter, "minecraft:rotation");
    // Set the rotation
    rotComponent.data.x = rotX;
    rotComponent.data.y = rotY;
    // Apply the changes to the rotation component
    this.applyComponentChanges(fighter, rotComponent);

    // Add a turn order component
    let turnOrderComponent = this.createComponent(fighter, "rpg_game:turn_order");
    // Set the turn order ui image name
    turnOrderComponent.data.image_name = image_name;
    // Apply the changes to the component
    this.applyComponentChanges(fighter, turnOrderComponent);

    // Initialize the health bar for the new fighter
    this.updateHealthBar(fighter);

    // Add the fighter to its team
    team.push(fighter);
};

aServerSystem.handlePlayerAbility = function (targetFighter, abilityType) {
    // Verify the fighter is a valid target
    if (!this.isValidTarget(targetFighter)) {
        return;
    }
    // Verify that the selected ability is valid
    if (!this.isValidAbilityType(abilityType)) {
        return;
    }

    // Use the ability on the target
    this.useAbility(targetFighter, abilityType);

    // Show some visual effects when a fighter is hit with an ability
    this.handleVisualHitEffects(targetFighter);

    // Nothing left to handle. End the current turn.
    this.endTurn();
};

aServerSystem.handleAIAbility = function () {
    // The AI chooses a random target on the players team.
    let targetFighter = this.getRandomValidTeamMember(globalVars.playerTeamArray);

    // Create an array of all the ability types
    let abilityTypes = [1, 2];
    // Randomize the order of the abilities
    shuffle(abilityTypes);
    // Get a random ability
    let abilityType = abilityTypes.pop();

    // Use the random ability against the target
    this.useAbility(targetFighter, abilityType);

    // Show some visual effects when a fighter is hit with an ability
    this.handleVisualHitEffects(targetFighter);

    // Nothing left to handle. End the current turn.
    this.endTurn();
};

aServerSystem.handleVisualHitEffects = function(targetFighter) {
    // Create a particle at the target fighters position
    let targetPosComponent = this.getComponent(targetFighter, "minecraft:position");
    let particleEventData = this.createEventData("minecraft:spawn_particle_in_world");
    particleEventData.data.effect = "minecraft:example_smoke_puff";
    particleEventData.data.position = [targetPosComponent.data.x, targetPosComponent.data.y, targetPosComponent.data.z];
    this.broadcastEvent("minecraft:spawn_particle_in_world", particleEventData);

    // Tell the client script to animate the on-hit animation for the fighter if it exists
    let hitAnimationEventData = this.createEventData("rpg_game:execute_on_hit_animation");
    hitAnimationEventData.data.fighter = targetFighter;
    this.broadcastEvent("rpg_game:execute_on_hit_animation", hitAnimationEventData);
}

aServerSystem.useAbility = function (targetFighter, abilityType) {
    // Handle each ability type
    if (abilityType === AbilityType.damageSingleTarget) {
        // Direct damage the target for 10 HP
        this.applyDamageToFighter(targetFighter, 10);
    }
    else if (abilityType === AbilityType.damageWholeTeam) {
        // Damage every valid target on the team for 3 HP
        let targetTeam = this.getTeamForFighter(targetFighter);
        targetTeam.forEach(function (fighter) {
            if (this.isValidTarget(fighter)) {
                this.applyDamageToFighter(fighter, 3);
            }
        }, this);
    }
    else if (abilityType === AbilityType.healSingleTarget) {
        // Heal the target for 7 HP
        this.applyDamageToFighter(targetFighter, -7);
    }
};

aServerSystem.endTurn = function () {
    // Reset which ability was selected to a invalid state
    globalVars.abilitySelected = AbilityType.none;
    // Reset the targeted fighter
    globalVars.targetedFighter = null;
    // Update which fighter is currently active
    this.updateTurnOrder();
    // Update the UI to show which fighter is active
    this.updateIndicatorPosition();
};

aServerSystem.checkForVictory = function () {
    // Callback returns whether a fighter is a valid target.
    let callback = function (fighter) {
        return this.isValidTarget(fighter);
    };

    // Check if there are no valid targets on the AI team.
    // If there isn't, then all the AI fighters have fainted and the player has won.
    let victory = globalVars.aiTeamArray.some(callback, this) === false;
    if (victory === true) {
        // Prevent the game update from running
        globalVars.gameRunning = false;
        // Let the client script know that the player won
        let victoryEventData = this.createEventData("rpg_game:victory");
        this.broadcastEvent("rpg_game:victory", victoryEventData);
    }

    // Check if there are no valid targets on the player team.
    // If there isn't, then all the player fighters have fainted and the AI has won.
    victory = globalVars.playerTeamArray.some(callback, this) === false;
    if (victory === true) {
        // Prevent the game update from running
        globalVars.gameRunning = false;
        // Let the client script know that the player lost
        let lossEventData = this.createEventData("rpg_game:loss");
        this.broadcastEvent("rpg_game:loss", lossEventData);
    }
};

aServerSystem.onClick = function (eventData) {
    // Only update the targeted fighter during the players turn and after they've selected an ability
    if (this.isPlayersTurn() === false || this.isValidAbilityType(globalVars.abilitySelected) === false) {
        return;
    }

    globalVars.targetedFighter = globalVars.lastFighterHoveredOver;
};

// Handle the ability button clicked event from the client script. 
aServerSystem.onAbilityClicked = function (eventData) {
    let abilityClicked = eventData.data.ability_clicked;
    // Set what ability was selected based on what the client script sent us
    if (abilityClicked === "damageSingleTargetAbilityClicked") {
        globalVars.abilitySelected = AbilityType.damageSingleTarget;
    }
    else if (abilityClicked === "damageWholeTeamAbilityClicked") {
        globalVars.abilitySelected = AbilityType.damageWholeTeam;
    }
    else if (abilityClicked === "healSingleTargetAbilityClicked") {
        globalVars.abilitySelected = AbilityType.healSingleTarget;
    }
    else {
        globalVars.abilitySelected = AbilityType.none;
    }
};

// Handle the start game event from the client script
aServerSystem.onStartGame = function (eventData) {
    globalVars.setupGame = true;
};

// Handle the leave game event from the client script
aServerSystem.onLeaveGame = function (eventData) {
    // Clear world
    this.clearWorld();
    globalVars.setupGame = false;
    globalVars.gameRunning = false;
};

// Handle when a fighter dies
aServerSystem.onEntityDeath = function (eventData) {
    // Get the position of the dead fighter
    let deadEntityPosition = this.getComponent(eventData.data.entity, "minecraft:position");
    // Create a lightning bolt
    let lightningBolt = this.createEntity("entity", "minecraft:lightning_bolt");
    // Get the lightning bolts position component    
    let boltPosition = this.getComponent(lightningBolt, "minecraft:position");
    // Set the lightning bolts position to the same position as the dying fighter
    boltPosition.data = deadEntityPosition.data;
    // Apply position change to the lightning bolt
    this.applyComponentChanges(lightningBolt, boltPosition);
    // Spawn a smoke puff particle at the dead fighters position as well
    let particleEventData = this.createEventData("minecraft:spawn_particle_in_world");
    particleEventData.data.effect = "minecraft:example_smoke_puff";
    particleEventData.data.position = [deadEntityPosition.data.x, deadEntityPosition.data.y, deadEntityPosition.data.z];
    this.broadcastEvent("minecraft:spawn_particle_in_world", particleEventData);

    //Do not remove the fighter yet, but queue it to be removed at the beginning of the next frame.
    globalVars.deadEntities.push(eventData.data.entity);
};

aServerSystem.handleDeadEntities = function(deadEntityArray) {
    // Keep going until the array is empty.
    while(deadEntityArray.length != 0) {
        // Pop the last entry off the array. This will reduce the size of the array by 1.
        let deadEntity = deadEntityArray.pop();

        // Remove the fighter from the registry. This will make subsequent calls to isValidEntity on a dead fighter to return false.
        this.destroyEntity(deadEntity);
    }
};

// Handle when a client has finished loading into the world
aServerSystem.onClientEnteredWorld = function (eventData) {
    // Clear the world and setup the arena on next update
    globalVars.needFirstSetup = true;
};

// Based on the passed in fighter return the array containing the fighter and its teammates
aServerSystem.getTeamForFighter = function (fighter) {
    // Fighter is on the AI team
    if (this.isFighterOnTeam(fighter, globalVars.aiTeamArray)) {
        return globalVars.aiTeamArray;
    }

    // Fighter is on the Player's team
    if (this.isFighterOnTeam(fighter, globalVars.playerTeamArray)) {
        return globalVars.playerTeamArray;
    }

    // Fighter is not on either team, return empty array
    return [];
};

// Gets the fighter based on the current turn
aServerSystem.getCurrentFighter = function () {
    return globalVars.turnOrderArray[globalVars.currentTurnOrderIndex];
};

aServerSystem.getRandomValidTeamMember = function (team) {
    let validFighters = [];
    // Get all the currently valid fighters for the given team
    team.forEach(function (fighter) {
        if (this.isValidTarget(fighter) === true) {
            validFighters.push(fighter);
        }
    }, this);

    // Randomize the order of the valid fighters
    shuffle(validFighters);

    // Return the last element of the randomized valid fighters
    return validFighters.pop();
};

aServerSystem.isValidAbilityType = function (abilityType) {
    // Only defined abilities are valid
    return abilityType === AbilityType.damageSingleTarget || abilityType === AbilityType.damageWholeTeam || abilityType === AbilityType.healSingleTarget;
};

// Returns whether the player has selected a valid ability and it is the players turn
aServerSystem.hasAbilitySelected = function () {
    return this.isValidAbilityType(globalVars.abilitySelected) === true && this.isPlayersTurn() === true;
};

aServerSystem.isFighterOnTeam = function (fighter, team) {
    // Return if the fighter is found on the team
    return team.find(teamFighter => teamFighter.id === fighter.id) !== undefined;
};

aServerSystem.isValidTarget = function (targetFighter) {
    // Verify with the engine that the fighter is a valid entity
    if (this.isValidEntity(targetFighter) === false) {
        return false;
    }

    // The fighter is not valid if it's not on a team
    if (!this.isFighterOnTeam(targetFighter, globalVars.aiTeamArray) && !this.isFighterOnTeam(targetFighter, globalVars.playerTeamArray)) {
        return false;
    }

    // Get the fighters health component. If the fighter doesn't have a health component or the fighters health is below zero then the fighter isn't valid.
    let healthComponent = this.getComponent(targetFighter, "minecraft:health");
    if (!healthComponent || healthComponent.data.value <= 0) {
        return false;
    }

    // Passed all tests, the fighter is a valid target.
    return true;
};

aServerSystem.isPlayersTurn = function () {
    // It is the players turn when a fighter on the players team is taking its turn.
    return globalVars.playerTeamArray.includes(this.getCurrentFighter());
};

aServerSystem.applyDamageToFighter = function (fighter, damage) {
    // Get the health component for the fighter
    let healthComponent = this.getComponent(fighter, "minecraft:health");
    // Change the health property on the component
    healthComponent.data.value -= damage;

    // Cap the health to the max health. Prevents healing from setting current health above the max.
    if (healthComponent.data.value > healthComponent.data.max) {
        healthComponent.data.value = healthComponent.data.max;
    }

    // Apply the changes to the health component.
    this.applyComponentChanges(fighter, healthComponent);

    // Update the health bar for the fighter to visually show changes
    this.updateHealthBar(fighter);
};

aServerSystem.updateTurnOrder = function () {
    // Increment the current turn order index.
    let nextTurnIndex = (globalVars.currentTurnOrderIndex + 1) % globalVars.turnOrderArray.length;
    // Check that the next fighter is still valid
    while (this.isValidTarget(globalVars.turnOrderArray[nextTurnIndex]) === false) {
        // Fighter wasn't valid, continue to the next index
        nextTurnIndex = (nextTurnIndex + 1) % globalVars.turnOrderArray.length;
    }
    // Valid fighter found, update the turn order index
    globalVars.currentTurnOrderIndex = nextTurnIndex;

    // Update the turn order UI for every fighter
    for (let i = 0; i < globalVars.turnOrderArray.length; i++) {
        // Default to inactive.
        let turnOrderState = TurnOrderState.inactive;
        // If this fighter is up next, set it to active
        if (globalVars.currentTurnOrderIndex === i) {
            turnOrderState = TurnOrderState.active;
        }
        // If this fighter is no longer a valid target, set it to fainted
        if (this.isValidTarget(globalVars.turnOrderArray[i]) === false) {
            turnOrderState = TurnOrderState.fainted;
        }

        // Send the update to the client script
        let turnOrderEventData = this.createEventData("rpg_game:update_turn_order");
        turnOrderEventData.data.order = i;
        turnOrderEventData.data.turn_order_state = turnOrderState;        
        this.broadcastEvent("rpg_game:update_turn_order", turnOrderEventData);
    }
};

aServerSystem.updateHealthBar = function (fighter) {
    // Get the name and health components of the fighter
    let nameComponent = this.getComponent(fighter, "minecraft:nameable");
    let healthComponent = this.getComponent(fighter, "minecraft:health");
    // Set the name based on the the fighters current and max health.
    nameComponent.data.name = "HP: " + healthComponent.data.value + " / " + healthComponent.data.max;
    // Set the name to always render
    nameComponent.data.alwaysShow = true;
    // Apply the changes to the component
    this.applyComponentChanges(fighter, nameComponent);
};

aServerSystem.updateIndicatorPosition = function () {
    // Get the currently active fighter
    let currentFighter = this.getCurrentFighter();
    // Verify the fighter is valid
    if (this.isValidEntity(currentFighter) === false) {
        return;
    }

    // Get the fighters position component
    let currentPosComponent = this.getComponent(currentFighter, "minecraft:position");

    // Reset the blocks in the arena to soul_sand with a slash command
    this.executeCommand("/fill -14 3 -4 14 3 14 soul_sand", (commandData) => this.commandCallback(commandData) );

    // Create a slash command to replace the blocks in a 3x3 square under the active fighter
    this.createAndExecute3x3FillCommand(currentPosComponent, "yellow_glazed_terracotta");
};

// Create a targeting indicator under the fighter using blocks
aServerSystem.updateTargetIndicator = function(oldTarget, newTarget) {
    // Verify the old target is valid
    if (this.isValidEntity(oldTarget) === true) {
        let currentFighter = this.getCurrentFighter();
        let oldTargetPos = this.getComponent(oldTarget, "minecraft:position");

        // If the old target is currently active we want to put the turn indicator blocks back under it
        if (this.isValidEntity(currentFighter) === true && oldTarget.id === currentFighter.id) {
            this.createAndExecute3x3FillCommand(oldTargetPos, "yellow_glazed_terracotta");
        }
        // Old target isn't currently active so replace with the default soul_sand
        else {
            this.createAndExecute3x3FillCommand(oldTargetPos, "soul_sand");
        }
    }

    // Verify the new target is valid and the player has already selected an ability
    if (this.isValidEntity(newTarget) === true && this.hasAbilitySelected() === true) {
        let newTargetPos = this.getComponent(newTarget, "minecraft:position");
        this.createAndExecute3x3FillCommand(newTargetPos, "red_glazed_terracotta");
    }
};

// Create and execute a /fill command to replace a 3x3 section of blocks based on the passed in position component and block name. 
// Assumes that a flat world is being used with the default height of 3.
aServerSystem.createAndExecute3x3FillCommand = function (posComponent, blockName) {
    if(posComponent) {
        let fillCommand = "/fill ";
        let lowX = posComponent.data.x - 1;
        let lowZ = posComponent.data.z - 1;
        let highX = posComponent.data.x + 1;
        let highZ = posComponent.data.z + 1;
        fillCommand += lowX + " 3 " + lowZ + " " + highX + " 3 " + highZ + " " + blockName;
        this.executeCommand(fillCommand, (commandData) => this.commandCallback(commandData) );
    }
};

aServerSystem.commandCallback = function (commandData) {
    //Used to debug command calls
};

// Randomly shuffle the elements of the passed in array
function shuffle(array) {
    for (let i = array.length - 1; i > 0; i--) {
        let randomIndex = Math.floor(Math.random() * (i + 1));
        let originalValue = array[i];
        array[i] = array[randomIndex];
        array[randomIndex] = originalValue;
    }
    return array;
}