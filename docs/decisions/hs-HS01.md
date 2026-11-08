# HS01 Host sparring setup and open-join presets

Welcome and open join read the same three display names from `OPEN_PLAYER_NAMES` in `packages/shared/src/protocol.ts`. The production access verifier and strict rejection of other names still apply. Before HS01 the Welcome screen could select Cagdas, but the open-session validator refused it before room creation.

The host chooses one of the three shipped fighters and a map from the existing registry. The shared game canvas renders the turntable while setup is open. It returns to the game when setup closes. The preview follows the same reduced-motion policy as the lobby.

Team play describes the server-managed opening roster and hides the manual roster. Switching back restores the manual choices. While a match is running, the setup overlay shows the guest-link and end-match controls. The arena, bot difficulty rules, and room authorization continue to use the existing server rules.
