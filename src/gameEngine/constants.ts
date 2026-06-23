export const CANVAS_W = 960;
export const CANVAS_H = 540;
export const FIELD_L = 60;
export const FIELD_R = 900;
export const FIELD_T = 50;
export const FIELD_B = 510;
export const FIELD_CX = 480;
export const FIELD_CY = 280;
export const GOAL_T = 215;
export const GOAL_B = 345;
export const GOAL_DEPTH = 18;
export const PLAYER_RADIUS = 18;
export const BALL_RADIUS = 10;
export const PLAYER_SPEED = 210;
export const KICK_RANGE = 40;
export const KICK_FORCE = 486; // -10% from 540
export const KICK_COOLDOWN = 0.25;
export const BUMP_FORCE = 110;
export const RETURN_SPEED = 115;
export const SUPPORT_PLAYER_SPEED = 120;
export const SUPPORT_KICK_FORCE = 320;
// The margin fades out as the current active player gets farther from the
// ball (see computeSwitchMargin in tick.ts) — once the ball is kicked across
// the pitch, the bias toward the old active player drops away and the
// nearest player takes over almost immediately.
export const ACTIVE_PLAYER_SWITCH_MARGIN = 18;
export const ACTIVE_PLAYER_SWITCH_MARGIN_FADE_DISTANCE = 300;
// Manual active-player switch (Q / PŘEP.) — mirrors the bot engine's
// MANUAL_SWITCH_LOCK_DURATION in game/constants.ts.
export const MANUAL_SWITCH_LOCK_DURATION = 2;
export const BALL_MAX_SPEED = 800;
export const MATCH_DURATION = 90;
export const GOAL_PAUSE_DURATION = 2.5;

// Ball control (soft trap for active player)
export const BALL_CONTROL_RADIUS = 44;
export const BALL_CONTROL_DAMPING = 0.86;
export const BALL_CONTROL_FORCE = 130;
export const BALL_CONTROL_INPUT_FORCE = 210;
export const BALL_CONTROL_OFFSET = 34;

// Corner clear
export const CORNER_ZONE_MARGIN = 72;
export const CORNER_CLEAR_DELAY = 8;
export const CORNER_CLEAR_SPEED = 360;
export const CORNER_CLEAR_REPOSITION = 96;
export const CORNER_CLEAR_COOLDOWN = 1.5;
