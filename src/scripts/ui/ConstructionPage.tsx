import Tippy from "@tippyjs/react";
import classNames from "classnames";
import { isSpecialBuilding, isWorldWonder } from "../../../shared/logic/BuildingLogic";
import { Config } from "../../../shared/logic/Config";
import { GameFeature, hasFeature } from "../../../shared/logic/FeatureLogic";
import { notifyGameStateUpdate } from "../../../shared/logic/GameStateLogic";
import { PRIORITY_MAX, PRIORITY_MIN, type ITileData } from "../../../shared/logic/Tile";
import { safeParseInt } from "../../../shared/utilities/Helper";
import { L, t } from "../../../shared/utilities/i18n";
import { useGameState } from "../Global";
import { WorldScene } from "../scenes/WorldScene";
import { useShortcut } from "../utilities/Hook";
import { Singleton } from "../utilities/Singleton";
import { playClick } from "../visuals/Sound";
import { ApplyToAllComponent } from "./ApplyToAllComponent";
import { BuildingConstructionProgressComponent } from "./BuildingConstructionProgressComponent";
import { BuildingDescriptionComponent } from "./BuildingDescriptionComponent";
import { BuildingInputModeComponent } from "./BuildingInputModeComponent";
import { MenuComponent } from "./MenuComponent";
import { RenderHTML } from "./RenderHTMLComponent";
import { WarningComponent } from "./WarningComponent";

export function ConstructionPage({ tile }: { tile: ITileData }): React.ReactNode {
   const building = tile.building;
   if (building == null) {
      return null;
   }
   const gs = useGameState();
   const definition = Config.Building[building.type];

   const canDecreaseDesiredLevel = () => building.desiredLevel > building.level + 1;

   const increaseDesiredLevel = () => {
      playClick();
      building.desiredLevel++;
      notifyGameStateUpdate();
   };
   const decreaseDesiredLevel = () => {
      if (canDecreaseDesiredLevel()) {
         playClick();
         building.desiredLevel--;
         notifyGameStateUpdate();
      }
   };
   useShortcut("UpgradePageIncreaseLevel", () => increaseDesiredLevel(), [tile]);
   useShortcut("UpgradePageDecreaseLevel", () => decreaseDesiredLevel(), [tile]);

   return (
      <div className="window">
         <div className="title-bar">
            <div className="title-bar-text">{definition.name()}</div>
         </div>
         <MenuComponent />
         <div className="window-body">
            {isWorldWonder(building.type) ? (
               <BuildingDescriptionComponent gameState={gs} xy={tile.tile} />
            ) : null}
            <BuildingConstructionProgressComponent xy={tile.tile} gameState={gs} />
            {building.level > 0 ? (
               <WarningComponent className="mb10 text-small" icon="warning">
                  <RenderHTML html={t(L.UpgradeBuildingNotProducingDescV2)} />
               </WarningComponent>
            ) : null}
            {isSpecialBuilding(building.type) ? null : (
               <fieldset>
                  <legend>{t(L.Level)}</legend>
                  <div className="row text-strong">
                     <div className="f1 text-large">
                        {building.level > 0 ? building.level : <div className="m-icon">construction</div>}
                     </div>
                     <div className="m-icon">keyboard_double_arrow_right</div>
                     <div
                        className="f1 row jce"
                        onWheel={(e) => {
                           if (e.deltaY < 0) {
                              building.desiredLevel++;
                              notifyGameStateUpdate();
                           }
                           if (e.deltaY > 0 && canDecreaseDesiredLevel()) {
                              building.desiredLevel--;
                              notifyGameStateUpdate();
                           }
                        }}
                     >
                        <div
                           className={classNames({
                              "m-icon mr5": true,
                              "text-link": canDecreaseDesiredLevel(),
                              "text-desc": !canDecreaseDesiredLevel(),
                           })}
                           onClick={() => decreaseDesiredLevel()}
                        >
                           indeterminate_check_box
                        </div>
                        <Tippy content={t(L.ScrollWheelAdjustLevelTooltip)}>
                           <div className="text-large text-center" style={{ width: "40px" }}>
                              {building.desiredLevel}
                           </div>
                        </Tippy>
                        <div className="m-icon ml5 text-link" onClick={() => increaseDesiredLevel()}>
                           add_box
                        </div>
                     </div>
                  </div>
               </fieldset>
            )}
            {hasFeature(GameFeature.BuildingProductionPriority, gs) ? (
               <fieldset>
                  <legend>
                     {t(L.ConstructionPriority)}: {building.constructionPriority}
                  </legend>
                  <input
                     type="range"
                     min={PRIORITY_MIN}
                     max={PRIORITY_MAX}
                     step="1"
                     value={building.constructionPriority}
                     onChange={(e) => {
                        building.constructionPriority = safeParseInt(e.target.value, PRIORITY_MIN);
                        notifyGameStateUpdate();
                     }}
                  />
                  <div className="sep15"></div>
                  <ApplyToAllComponent
                     building={building}
                     getOptions={(s) => ({ constructionPriority: building.constructionPriority })}
                     gameState={gs}
                  />
               </fieldset>
            ) : null}
            {hasFeature(GameFeature.BuildingInputMode, gs) ? (
               <BuildingInputModeComponent gameState={gs} xy={tile.tile} />
            ) : null}
            {building.level > 0 ? (
               <fieldset>
                  <WarningComponent icon="info" className="mb10 text-small">
                     <RenderHTML html={t(L.CancelUpgradeDesc)} />
                  </WarningComponent>
                  <button
                     className="jcc w100 row"
                     onClick={() => {
                        building.status = "completed";
                        building.desiredLevel = building.level;
                        notifyGameStateUpdate();
                     }}
                  >
                     <div className="m-icon small">delete</div>
                     <div className="f1 text-strong">{t(L.CancelUpgrade)}</div>
                  </button>
               </fieldset>
            ) : (
               <fieldset>
                  <WarningComponent icon="warning" className="mb10 text-small">
                     <RenderHTML html={t(L.EndConstructionDescHTML)} />
                  </WarningComponent>
                  <button
                     className="jcc w100 row"
                     onClick={() => {
                        delete tile.building;
                        Singleton().sceneManager.enqueue(WorldScene, (s) => s.resetTile(tile.tile));
                        notifyGameStateUpdate();
                     }}
                  >
                     <div className="m-icon small">delete</div>
                     <div className="f1 text-strong">{t(L.EndConstruction)}</div>
                  </button>
               </fieldset>
            )}
         </div>
      </div>
   );
}
