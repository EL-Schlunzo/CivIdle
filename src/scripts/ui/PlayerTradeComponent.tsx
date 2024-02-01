import classNames from "classnames";
import { useEffect, useState } from "react";
import type { Resource, ResourceDefinitions } from "../../../shared/definitions/ResourceDefinitions";
import { getStorageFor } from "../../../shared/logic/BuildingLogic";
import { Config } from "../../../shared/logic/Config";
import { TRADE_CANCEL_REFUND_PERCENT } from "../../../shared/logic/Constants";
import { notifyGameStateUpdate } from "../../../shared/logic/GameStateLogic";
import { getMaxActiveTrades } from "../../../shared/logic/PlayerTradeLogic";
import type { IPendingClaim } from "../../../shared/utilities/Database";
import { formatPercent, isNullOrUndefined, safeAdd } from "../../../shared/utilities/Helper";
import { L, t } from "../../../shared/utilities/i18n";
import { AccountLevelImages, AccountLevelNames } from "../logic/AccountLevel";
import { OnNewPendingClaims, client, useTrades, useUser } from "../rpc/RPCClient";
import { getMyMapXy } from "../scenes/PathFinder";
import { PlayerMapScene } from "../scenes/PlayerMapScene";
import { getCountryName, getFlagUrl } from "../utilities/CountryCode";
import { useTypedEvent } from "../utilities/Hook";
import { Singleton } from "../utilities/Singleton";
import { playClick, playError, playKaching } from "../visuals/Sound";
import { AddTradeComponent } from "./AddTradeComponent";
import type { IBuildingComponentProps } from "./BuildingPage";
import { ConfirmModal } from "./ConfirmModal";
import { FillPlayerTradeModal } from "./FillPlayerTradeModal";
import { showModal, showToast } from "./GlobalModal";
import { FormatNumber } from "./HelperComponents";
import { WarningComponent } from "./WarningComponent";
import type { IClientTrade } from "../../../shared/logic/PlayerTradeLogic";

interface IPlayerTradeFiltersProps {
   wantFilterParams: {wantFilter: string, setWantFilter: React.Dispatch<React.SetStateAction<string>>},
   offerFilterParams: {offerFilter: string, setOfferFilter: React.Dispatch<React.SetStateAction<string>>},
   trades: IClientTrade[],
}

export function PlayerTradeFilters({wantFilterParams, offerFilterParams, trades}: IPlayerTradeFiltersProps ): React.ReactNode {
   const { wantFilter, setWantFilter} = wantFilterParams;
   const { offerFilter, setOfferFilter} = offerFilterParams;
   
   const [showFilters, setShowFilters] = useState(false);

   const uniqueBuyResources: Set<Resource> = new Set();
   trades.map((trade) => {
     uniqueBuyResources.add(trade.buyResource);
   });   
   const uniqueSellResources: Set<Resource> = new Set();
   trades.map((trade) => {
      uniqueSellResources.add(trade.sellResource);
   });    

   if ( showFilters ) {
      return (
         <fieldset>
            <legend className="text-strong">Filters</legend>
            <div className="row">
               <div style={{ width: "80px" }}>{t(L.PlayerTradeWant)}</div>
               <select
                  className="f1"
                  value={wantFilter}
                  onChange={(e) => {
                     if (e.target.value in Config.Resource || e.target.value === "") {
                        setWantFilter(e.target.value);
                     }
                  }}
               >
                  <option key="Empty" value="">                     
                  </option>

                  {Array.from(uniqueBuyResources).map((res) => (
                     <option key={res} value={res}>
                        {Config.Resource[res].name()}
                     </option>
                  ))}
               </select>
            </div>
            <div className="sep10"></div>
            <div className="row">
               <div style={{ width: "80px" }}>{t(L.PlayerTradeOffer)}</div>
               <select
                  className="f1"
                  value={offerFilter}
                  onChange={(e) => {
                     if (e.target.value in Config.Resource || e.target.value === "") {
                        setOfferFilter(e.target.value);
                     }
                  }}
               >
                  <option key="Empty" value="">                     
                  </option>

                  {Array.from(uniqueSellResources).map((res) => (
                     <option key={res} value={res}>
                        {Config.Resource[res].name()}
                     </option>
                  ))}
               </select>
            </div>     
            <div className="sep10"></div>
            <div className="row">
            <button
                  className="row f1 jcc"
                  onClick={() => {
                     setShowFilters(false);
                  }}
               >
                  Close
               </button>               
            </div>
         </fieldset>
      );
   }
   return (
      <button
         className="row w100 jcc mb10"
         onClick={() => {
            setShowFilters(true);
         }}
      >
         <div className="m-icon small mr5">add_circle</div>
         <div className="text-strong">Filters</div>
      </button>
   );
}

export function PlayerTradeComponent({ gameState, xy }: IBuildingComponentProps): React.ReactNode {
   const building = gameState.tiles.get(xy)?.building;
   if (!building) {
      return null;
   }
   const trades = useTrades();
   const user = useUser();
   const myXy = getMyMapXy();
   const [wantFilter, setWantFilter] = useState<keyof ResourceDefinitions|string>("");
   const [offerFilter, setOfferFilter] = useState<keyof ResourceDefinitions|string>("");

   if (!myXy) {
      return (
         <>
            <WarningComponent icon="info">
               <div>{t(L.PlayerTradeClaimTileFirstWarning)}</div>
               <div
                  className="text-strong text-link row"
                  onClick={() => Singleton().sceneManager.loadScene(PlayerMapScene)}
               >
                  {t(L.PlayerTradeClaimTileFirst)}
               </div>
            </WarningComponent>
            <div className="sep10"></div>
         </>
      );
   }

   return (
      <fieldset>
         <legend>{t(L.PlayerTrade)}</legend>
         <PendingClaimComponent gameState={gameState} xy={xy} />
         <AddTradeComponent
            enabled={
               !isNullOrUndefined(user) &&
               trades.filter((t) => t.fromId === user.userId).length < getMaxActiveTrades(user)
            }
            gameState={gameState}
            xy={xy}
         />
         <PlayerTradeFilters 
            wantFilterParams={{wantFilter, setWantFilter}}
            offerFilterParams={{offerFilter, setOfferFilter}}
            trades={trades}/>
         <div className="table-view">
            <table>
               <tbody>
                  <tr>
                     <th>{t(L.PlayerTradeWant)}</th>
                     <th>{t(L.PlayerTradeOffer)}</th>
                     <th>{t(L.PlayerTradeFrom)}</th>
                     <th></th>
                  </tr>
                  {trades
                  .filter((t) => {
                     if ( wantFilter === "" && offerFilter === "" ) {
                        return true;
                     }
                     if ( t.buyResource === wantFilter && offerFilter === "" ) {
                        return true;
                     }
                     if ( t.sellResource === offerFilter && wantFilter === "" ) {
                        return true;
                     }
                     if ( t.buyResource === wantFilter && t.sellResource === offerFilter ) {
                        return true;
                     }
                     return false;
                  })
                  .map((trade) => {
                     const disableFill = user === null || trade.fromId === user.userId;
                     return (
                        <tr
                           key={trade.id}
                           className={classNames({ "text-strong": trade.fromId === user?.userId })}
                        >
                           <td>
                              <div>{Config.Resource[trade.buyResource].name()}</div>
                              <div className="text-small text-strong text-desc">
                                 <FormatNumber value={trade.buyAmount} />
                              </div>
                           </td>
                           <td>
                              <div>{Config.Resource[trade.sellResource].name()}</div>
                              <div className="text-small text-strong text-desc">
                                 <FormatNumber value={trade.sellAmount} />
                              </div>
                           </td>
                           <td>
                              <div className="row">
                                 <img
                                    src={getFlagUrl(trade.fromFlag)}
                                    className="player-flag game-cursor"
                                    title={getCountryName(trade.fromFlag)}
                                 />
                                 {trade.fromLevel > 0 ? (
                                    <img
                                       src={AccountLevelImages[trade.fromLevel]}
                                       className="player-flag"
                                       title={AccountLevelNames[trade.fromLevel]()}
                                    />
                                 ) : null}
                              </div>
                              <div className="text-small">{trade.from}</div>
                           </td>
                           <td>
                              {trade.fromId === user?.userId ? (
                                 <div
                                    className="m-icon small text-link"
                                    onClick={() => {
                                       showModal(
                                          <ConfirmModal
                                             title={t(L.PlayerTradeCancelTrade)}
                                             onConfirm={async () => {
                                                try {
                                                   const { total, used } = getStorageFor(xy, gameState);
                                                   if (
                                                      used + trade.sellAmount * TRADE_CANCEL_REFUND_PERCENT >
                                                      total
                                                   ) {
                                                      throw new Error(
                                                         t(L.PlayerTradeCancelTradeNotEnoughStorage),
                                                      );
                                                   }
                                                   const cancelledTrade = await client.cancelTrade(trade.id);
                                                   safeAdd(
                                                      building.resources,
                                                      cancelledTrade.sellResource,
                                                      cancelledTrade.sellAmount * TRADE_CANCEL_REFUND_PERCENT,
                                                   );
                                                   playKaching();
                                                } catch (error) {
                                                   showToast(String(error));
                                                   playError();
                                                }
                                             }}
                                          >
                                             {t(L.PlayerTradeCancelDesc, {
                                                percent: formatPercent(TRADE_CANCEL_REFUND_PERCENT),
                                             })}
                                          </ConfirmModal>,
                                       );
                                    }}
                                 >
                                    delete
                                 </div>
                              ) : (
                                 <div
                                    className={classNames({
                                       "text-link": !disableFill,
                                       "text-strong": true,
                                       "text-desc": disableFill,
                                    })}
                                    onClick={() => {
                                       if (!disableFill) {
                                          showModal(<FillPlayerTradeModal trade={trade} xy={xy} />);
                                       }
                                    }}
                                 >
                                    {t(L.PlayerTradeFill)}
                                 </div>
                              )}
                           </td>
                        </tr>
                     );
                  })}
               </tbody>
            </table>
         </div>
      </fieldset>
   );
}

function PendingClaimComponent({ gameState, xy }: IBuildingComponentProps) {
   const [pendingClaims, setPendingClaims] = useState<IPendingClaim[]>([]);
   useEffect(() => {
      client.getPendingClaims().then(setPendingClaims);
   }, []);
   useTypedEvent(OnNewPendingClaims, () => {
      client.getPendingClaims().then(setPendingClaims);
   });

   if (pendingClaims.length === 0) {
      return null;
   }
   return (
      <>
         <div className="table-view">
            <table>
               <tr>
                  <th>{t(L.PlayerTradeResource)}</th>
                  <th>{t(L.PlayerTradeFillBy)}</th>
                  <th className="text-right">{t(L.PlayerTradeAmount)}</th>
                  <th></th>
               </tr>
               {pendingClaims.map((trade) => {
                  return (
                     <tr key={trade.id}>
                        <td>{Config.Resource[trade.resource as Resource].name()}</td>
                        <td>{trade.fillBy}</td>
                        <td className="text-right">
                           <FormatNumber value={trade.amount} />
                        </td>
                        <td
                           className="text-right text-strong text-link"
                           onClick={async () => {
                              const { total, used } = getStorageFor(xy, gameState);
                              if (total - used >= trade.amount) {
                                 await client.claimTrade(trade.id).then(setPendingClaims);
                                 const building = gameState.tiles.get(xy)?.building;
                                 if (building) {
                                    playClick();
                                    safeAdd(building.resources, trade.resource, trade.amount);
                                    notifyGameStateUpdate();
                                 }
                              } else {
                                 showToast(t(L.PlayerTradeClaimNotEnoughStorage));
                                 playError();
                              }
                           }}
                        >
                           <span>{t(L.PlayerTradeClaim)}</span>
                        </td>
                     </tr>
                  );
               })}
            </table>
         </div>
         <div className="sep10"></div>
      </>
   );
}
