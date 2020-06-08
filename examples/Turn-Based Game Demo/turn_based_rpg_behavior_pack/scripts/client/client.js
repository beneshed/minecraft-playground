const aClientSystem = client.registerSystem(0, 0);

// Global variables
let globalVars = {};

// A query to control fighters that need to be animated
globalVars.animationQuery = {};

// Setup which events to listen for
aClientSystem.initialize = function () {
    this.listenForEvent("minecraft:pick_hit_result_changed", (eventData) => this.onPick(eventData));

    // Setup callback for when the player enters the world
    this.listenForEvent("minecraft:client_entered_world", (eventData) => this.onClientEnteredWorld(eventData));

    // Setup callback for UI events from the custom screens
    this.listenForEvent("minecraft:ui_event", (eventData) => this.onUIMessage(eventData));

    // Setup callback for the victory event from the server script
    this.listenForEvent("rpg_game:victory", (eventData) => this.onVictory(eventData));

    // Setup callback for the loss event from the server script
    this.listenForEvent("rpg_game:loss", (eventData) => this.onLoss(eventData));

    // Setup callback for the turn order event from the server script
    this.listenForEvent("rpg_game:update_turn_order", (eventData) => this.onUpdateTurnOrder(eventData));

    // Setup callback to handle the on-hit animation from the server script
    this.listenForEvent("rpg_game:execute_on_hit_animation", (eventData) => this.onExecuteOnHitAnimation(eventData));	

    // Register a script only component to help control animations
    this.registerComponent("rpg_game:animation_controller", { counter: 0 });

    // Register a query to get all fighters that have the custom component that helps control animations
    globalVars.animationQuery = this.registerQuery();
    this.addFilterToQuery(globalVars.animationQuery, "rpg_game:animation_controller");

    this.registerEventData("rpg_game:update_hovered_target", {entity: null});
    this.registerEventData("rpg_game:client_entered_world", {});
    this.registerEventData("rpg_game:ability_clicked", {ability_clicked: null});
    this.registerEventData("rpg_game:click", {});
    this.registerEventData("rpg_game:start", {});
    this.registerEventData("rpg_game:leave", {});
};

aClientSystem.update = function () {
    // Update all animating fighters
    this.UpdateAnimationState();
};

aClientSystem.onPick = function (eventData) {
    let hoveredEventData = this.createEventData("rpg_game:update_hovered_target");
    hoveredEventData.data.entity = eventData.data.entity;
    // Relay pick event to the server script to update the newest hovered target
    this.broadcastEvent("rpg_game:update_hovered_target", hoveredEventData);
};

aClientSystem.onUpdateTurnOrder = function (turnOrderData) {
    // Package up the turn order data to send to the custom screen for display.
    // The data property requires a string. Turn an object into a string by using JSON.stringify()
    let uiEventData = this.createEventData("minecraft:send_ui_event");
    uiEventData.data.eventIdentifier = "UpdateTurnOrder";
    uiEventData.data.data = JSON.stringify(turnOrderData.data);

    // Send the event to the custom screen
    this.broadcastEvent("minecraft:send_ui_event", uiEventData);
};

aClientSystem.onClientEnteredWorld = function (eventData) {
    // Client has entered the world, show the starting screen
    let loadEventData = this.createEventData("minecraft:load_ui");
    loadEventData.data.path = "rpg_game_start.html";
    loadEventData.data.options.is_showing_menu = false;
    loadEventData.data.options.absorbs_input = true;
    aClientSystem.broadcastEvent("minecraft:load_ui", loadEventData);

    // Notify the server script that the player has finished loading in.
    let clientEnteredEventData = this.createEventData("rpg_game:client_entered_world");
	aClientSystem.broadcastEvent("rpg_game:client_entered_world", clientEnteredEventData);
};

aClientSystem.onVictory = function (eventData) {
    // Server told us that the player won, remove the game screen and show the victory screen
    let unloadEventData = this.createEventData("minecraft:unload_ui");
    unloadEventData.data.path = "rpg_game.html";
    this.broadcastEvent("minecraft:unload_ui", unloadEventData);

    let loadEventData = this.createEventData("minecraft:load_ui");
    loadEventData.data.path = "rpg_game_victory.html";
    loadEventData.data.options.is_showing_menu = false;
    loadEventData.data.options.absorbs_input = true;
    this.broadcastEvent("minecraft:load_ui", loadEventData);
};

aClientSystem.onLoss = function (eventData) {
    // Server told us that the player lost, remove the game screen and show the loss screen
    let unloadEventData = this.createEventData("minecraft:unload_ui");
    unloadEventData.data.path = "rpg_game.html";
    this.broadcastEvent("minecraft:unload_ui", unloadEventData);

    let loadEventData = this.createEventData("minecraft:load_ui");
    loadEventData.data.path = "rpg_game_loss.html";
    loadEventData.data.options.is_showing_menu = false;
    loadEventData.data.options.absorbs_input = true;
    this.broadcastEvent("minecraft:load_ui", loadEventData);
};

aClientSystem.onUIMessage = function (eventDataObject) {
    //Get the data out of the event data object. If there's no data, nothing to do inside here
    let eventData = eventDataObject.data;
    if(!eventData) {
        return;
    }

    // UI engine sent us an event.
    if (eventData === "damageSingleTargetAbilityClicked" ||
        eventData === "damageWholeTeamAbilityClicked" ||
        eventData === "healSingleTargetAbilityClicked") {
        // An ability button was clicked. Send an ability clicked event to the server script
        let abilityEventData = this.createEventData("rpg_game:ability_clicked");
        abilityEventData.data.ability_clicked = eventData;
        this.broadcastEvent("rpg_game:ability_clicked", abilityEventData);
    }
    else if (eventData === "rpg_game:click") {
        let clickEventData = this.createEventData("rpg_game:click");
        this.broadcastEvent("rpg_game:click", clickEventData);
    }
    else if (eventData === "startPressed" || eventData === "restartPressed") {
        // Start or restart button was pressed on a screen. Start up the game.
        this.startGame();
    }
    else if (eventData === "leavePressed") {
        // Leave button was pressed. Exit all custom screens and stop turn-based game.
        this.leaveGame();
    }
};

aClientSystem.startGame = function () {
    // Remove any screens we might have loaded
    let unloadEventData = this.createEventData("minecraft:unload_ui");    
    unloadEventData.data.path = "rpg_game_start.html";
    this.broadcastEvent("minecraft:unload_ui", unloadEventData);

    unloadEventData.data.path = "rpg_game.html";
    this.broadcastEvent("minecraft:unload_ui", unloadEventData);

    unloadEventData.data.path = "rpg_game_loss.html";
    this.broadcastEvent("minecraft:unload_ui", unloadEventData);

    unloadEventData.data.path = "rpg_game_victory.html";
    this.broadcastEvent("minecraft:unload_ui", unloadEventData);

    // Load and show the game screen
    let loadEventData = this.createEventData("minecraft:load_ui");
    loadEventData.data.path = "rpg_game.html";
    loadEventData.data.options.is_showing_menu = false;
    loadEventData.data.options.absorbs_input = true;
    this.broadcastEvent("minecraft:load_ui", loadEventData);

    // Tell the server to start the game
    let startEventData = this.createEventData("rpg_game:start");
    this.broadcastEvent("rpg_game:start", startEventData);
};

aClientSystem.leaveGame = function () {
    // Remove any screens we might have loaded
    let unloadEventData = this.createEventData("minecraft:unload_ui");    
    unloadEventData.data.path = "rpg_game_start.html";
    this.broadcastEvent("minecraft:unload_ui", unloadEventData);

    unloadEventData.data.path = "rpg_game.html";
    this.broadcastEvent("minecraft:unload_ui", unloadEventData);

    unloadEventData.data.path = "rpg_game_loss.html";
    this.broadcastEvent("minecraft:unload_ui", unloadEventData);

    unloadEventData.data.path = "rpg_game_victory.html";
    this.broadcastEvent("minecraft:unload_ui", unloadEventData);

    // Tell the server to leave the game
    let leaveEventData = this.createEventData("rpg_game:leave");
    this.broadcastEvent("rpg_game:leave", leaveEventData);
};

aClientSystem.onExecuteOnHitAnimation = function(eventData) {
    // Add a animation controller component to the fighter that was just hit
    // Used to track animation counters
    this.createComponent(eventData.data.fighter, "rpg_game:animation_controller");
};

aClientSystem.UpdateAnimationState = function () {
    // Get all currently animating fighters
    let animatedFighters = this.getEntitiesFromQuery(globalVars.animationQuery);

    // Update animation 
    for (let index in animatedFighters) {
        let fighter = animatedFighters[index];
        let molangComponent = this.getComponent(fighter, "minecraft:molang");
        // Get the animation controller component that was added when the fighter was hit
        let animationComponent = this.getComponent(fighter, "rpg_game:animation_controller");
        if (animationComponent.data.counter < 1) {
            // Increment counter and base the fighters animation on it
            animationComponent.data.counter += 0.03;
            molangComponent.data["variable.script_attacktime"] = animationComponent.data.counter;
            this.applyComponentChanges(fighter, animationComponent);
        }
        else {
            // Animation has finished. Reset the molang component. Remove the animation controller component from the fighter.
            molangComponent.data["variable.script_attacktime"] = 0;
            this.destroyComponent(fighter, "rpg_game:animation_controller");
        }
        this.applyComponentChanges(fighter, molangComponent);
    }
};
