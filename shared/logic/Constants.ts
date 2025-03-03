import type { Building } from "../definitions/BuildingDefinitions";
import { BuildingSpecial } from "../definitions/BuildingDefinitions";
import type { City } from "../definitions/CityDefinitions";
import type { Resource } from "../definitions/ResourceDefinitions";
import { IsDeposit, NoPrice } from "../definitions/ResourceDefinitions";
import type { Tech, TechAge } from "../definitions/TechDefinitions";
import {
   HOUR,
   forEach,
   formatHMS,
   formatNumber,
   isEmpty,
   keysOf,
   mapSafeAdd,
   numberToRoman,
   round,
   sizeOf,
} from "../utilities/Helper";
import type { PartialSet, PartialTabulate } from "../utilities/TypeDefinitions";
import {
   getBuildingCost,
   getWonderBaseBuilderCapacity,
   isSpecialBuilding,
   isWorldWonder,
} from "./BuildingLogic";
import { Config } from "./Config";
import { getOrderedTechThatProduce } from "./ResourceLogic";
import {
   getAgeForTech,
   getBuildingUnlockTech,
   getDepositUnlockTech,
   getResourceUnlockTech,
} from "./TechLogic";

export const MAX_OFFLINE_PRODUCTION_SEC = 60 * 60 * 4;
export const SCIENCE_VALUE = 0.5;
export const MAX_TRIBUNE_CARRY_OVER_LEVEL = 2;
export const TRADE_CANCEL_REFUND_PERCENT = 0.9;
export const TRIBUNE_UPGRADE_PLAYTIME = 48 * HOUR;
export const MAX_CHAT_PER_CHANNEL = 200;
export const DISCORD_URL = "https://discord.com/invite/m5JWZtEKMZ";
export const BACKUP_RECOVERY_URL =
   "https://steamcommunity.com/app/2181940/discussions/0/7260435610010445264/";
export const TRIBUNE_TRADE_VALUE_PER_MINUTE = 10000;
export const MAX_TARIFF_RATE = 0.1;
export const OXFORD_SCIENCE_PER_UPGRADE = 5;
export const MARKET_DEFAULT_TRADE_COUNT = 5;
export const MAX_EXPLORER = 10;
export const EXPLORER_SECONDS = 60;

interface IRecipe {
   building: Building;
   input: PartialTabulate<Resource>;
   output: PartialTabulate<Resource>;
}

export function calculateTierAndPrice() {
   forEach(IsDeposit, (k) => {
      Config.ResourceTier[k] = 1;
      Config.ResourcePrice[k] = 1 + Config.Tech[getDepositUnlockTech(k)].column;
   });

   const allRecipes: IRecipe[] = [];

   let buildingHash = 0;
   forEach(Config.Building, (building, buildingDef) => {
      Config.BuildingHash[building] = buildingHash++;
      if (isEmpty(buildingDef.input)) {
         forEach(buildingDef.output, (res) => {
            if (!Config.ResourceTier[res]) {
               Config.ResourceTier[res] = 1;
            }
            if (!Config.ResourcePrice[res]) {
               const tech = getBuildingUnlockTech(building);
               if (tech) {
                  Config.ResourcePrice[res] = 1 + Config.Tech[tech].column;
               } else {
                  Config.ResourcePrice[res] = 1;
               }
            }
         });
         if (!Config.BuildingTier[building]) {
            Config.BuildingTier[building] = 1;
         }
      }
      if (!isEmpty(buildingDef.input) || !isEmpty(buildingDef.output)) {
         allRecipes.push({
            building,
            input: buildingDef.input,
            output: buildingDef.output,
         });
      }

      const tech = getBuildingUnlockTech(building);
      if (tech) {
         forEach(buildingDef.input, (res) => {
            const t = getResourceUnlockTech(res);
            if (t) {
               console.assert(
                  Config.Tech[t].column < Config.Tech[tech].column,
                  `Input: Expect Unlock(${building}=${tech},${Config.Tech[tech].column}) > Unlock(${res}=${t},${Config.Tech[t].column})`,
               );
            } else {
               console.error(
                  `Input: Expect Unlock(${building}=${tech},${Config.Tech[tech].column}) > Unlock(${res}=${t},NotFound)`,
               );
            }
         });
         forEach(buildingDef.construction, (res) => {
            const t = getResourceUnlockTech(res);
            if (t && t !== tech && Config.Tech[t].column > 0) {
               console.assert(
                  Config.Tech[t].column < Config.Tech[tech].column,
                  `Construction: Expect Unlock(${building}=${tech},${Config.Tech[tech].column}) > Unlock(${res}=${t},${Config.Tech[t].column})`,
               );
            }
         });
      } else {
         if (
            buildingDef.special !== BuildingSpecial.HQ &&
            buildingDef.special !== BuildingSpecial.NaturalWonder
         ) {
            console.error(`Building: ${building} is not unlocked by any tech!`);
         }
      }

      let key: Tech;
      const result: Tech[] = [];
      for (key in Config.Tech) {
         if (Config.Tech[key].unlockBuilding?.includes(building)) {
            result.push(key);
         }
      }
      console.assert(
         result.length <= 1,
         `Building ${building} should only be unlocked by one tech (${result.join(",")})`,
      );
   });

   forEach(Config.Tech, (tech, techDef) => {
      techDef.unlockBuilding?.forEach((b) => {
         const techLevel = techDef.column + 1;
         Config.BuildingTech[b] = techLevel;
         forEach(Config.Building[b].output, (res) => {
            if (Config.ResourceTech[res] && Config.ResourceTech[res]! > techLevel) {
               return;
            }
            Config.ResourceTech[res] = techLevel;
         });
         forEach(Config.City, (city, def) => {
            if (def.uniqueBuildings[b]) {
               console.error(`${city}'s unique building ${b} should not be unlocked by ${tech}`);
            }
         });
         console.assert(
            // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing
            !isEmpty(Config.Building[b].input) || !isEmpty(Config.Building[b].construction),
            `${b}: A building should have either 'input' or 'construction' defined`,
         );
      });
   });

   const resourceTierDependency: Partial<Record<Resource, Resource>> = {};
   const buildingTierDependency: Partial<Record<Building, Resource>> = {};

   while (sizeOf(Config.BuildingTier) < sizeOf(Config.Building)) {
      allRecipes.forEach(({ building, input, output }) => {
         let maxInputResourceTier = 0;
         let inputResourcesValue = 0;
         let maxInputResource: Resource | null = null;
         const allInputResourcesHasTier = keysOf(input).every((r) => {
            const tier = Config.ResourceTier[r];
            const price = Config.ResourcePrice[r];
            if (tier && tier > maxInputResourceTier) {
               maxInputResourceTier = tier;
               maxInputResource = r;
            }
            if (price) {
               inputResourcesValue += price * (input[r] ?? 0);
            }
            return tier && price;
         });
         if (allInputResourcesHasTier) {
            const targetTier = maxInputResourceTier + 1;
            let allOutputAmount = 0;
            let notPricedResourceValue = 0;
            forEach(output, (res, amount) => {
               if (res === "Science") {
                  // Science is internally valued at 0.5
                  notPricedResourceValue += amount * SCIENCE_VALUE;
                  return;
               }
               if (!Config.ResourceTier[res] || targetTier < Config.ResourceTier[res]!) {
                  const oldTier = Config.ResourceTier[res];
                  Config.ResourceTier[res] = targetTier;
                  if (maxInputResource) {
                     resourceTierDependency[res] = maxInputResource;
                  }
                  forEach(resourceTierDependency, (k, v) => {
                     if (v === res) {
                        delete resourceTierDependency[k];
                        delete Config.ResourceTier[k];
                        console.log(
                           `Resource Tier of ${k} is decided by ${res}, but its tier has changed from ${
                              oldTier ?? "?"
                           } to ${targetTier}`,
                        );
                     }
                  });
                  forEach(buildingTierDependency, (k, v) => {
                     if (v === res) {
                        delete buildingTierDependency[k];
                        delete Config.BuildingTier[k];
                        console.log(
                           `Building Tier of ${k} is decided by ${res}, but its tier has changed from ${
                              oldTier ?? "?"
                           } to ${targetTier}`,
                        );
                     }
                  });
               }
               allOutputAmount += amount;
            });
            if (!Config.BuildingTier[building] || targetTier > Config.BuildingTier[building]!) {
               Config.BuildingTier[building] = targetTier;
            }
            forEach(output, (res) => {
               const price = (2 * inputResourcesValue - notPricedResourceValue) / allOutputAmount;
               if (!Config.ResourcePrice[res]) {
                  Config.ResourcePrice[res] = price;
               } else if (price > Config.ResourcePrice[res]!) {
                  console.warn(
                     `Price of ${res} changed from ${Config.ResourcePrice[res]!} to ${price} by ${building}`,
                  );
                  Config.ResourcePrice[res] = price;
               }
            });
         }
      });
   }

   const endResources: PartialSet<Resource> = {};
   let resourceHash = 0;
   forEach(Config.Resource, (r) => {
      Config.ResourceHash[r] = resourceHash++;
      if (!NoPrice[r]) {
         console.assert(!!Config.ResourceTier[r], `Resource = ${r} does not have a tier`);
         console.assert(!!Config.ResourcePrice[r], `Resource = ${r} does not have a price`);
      } else {
         Config.ResourcePrice[r] = 1;
         Config.ResourceTier[r] = 1;
      }

      let isEndResource = true;
      forEach(Config.Building, (b, def) => {
         if (def.input[r]) {
            isEndResource = false;
         }
      });
      if (isEndResource) {
         endResources[r] = true;
      }
   });

   const uniqueBuildings: Partial<Record<Building, City>> = {};

   forEach(Config.City, (city, def) => {
      forEach(def.uniqueBuildings, (k, v) => {
         if (uniqueBuildings[k]) {
            console.error(`Duplicated unique buildings ${k} found in ${uniqueBuildings[k]} and ${city}`);
            return;
         }
         uniqueBuildings[k] = city;
      });
   });

   const wonderCost: string[] = [];
   const resourcesUsedByWonder = new Map<Resource, number>();
   keysOf(Config.Building)
      .sort((a, b) => {
         const techA = getBuildingUnlockTech(a);
         const techB = getBuildingUnlockTech(b);
         if (techA && techB) {
            return Config.Tech[techA].column - Config.Tech[techB].column;
         }
         return 0;
      })
      .forEach((k) => {
         if (isWorldWonder(k)) {
            let value = 0;
            let cost = "";
            let totalAmount = 0;
            const baseBuilderCapacity = getWonderBaseBuilderCapacity(k);
            const wonderAge = getAgeForTech(getBuildingUnlockTech(k)!)!;
            forEach(getBuildingCost({ type: k, level: 0 }), (res, amount) => {
               mapSafeAdd(resourcesUsedByWonder, res, 1);
               const tech = getOrderedTechThatProduce(res);
               const resourceAge = getAgeForTech(tech[0])!;
               totalAmount += amount;
               const ageDiff = Config.TechAge[wonderAge].idx - Config.TechAge[resourceAge].idx;
               const ageDiffIndicator: string[] = [];
               for (let i = 0; i < ageDiff; i++) {
                  ageDiffIndicator.push("*");
               }
               cost += `${ageDiffIndicator.join("")}${res}: ${formatNumber(amount)}, `;
               value += Config.ResourcePrice[res]! * amount;
            });
            cost = `${k.padEnd(25)} ${formatNumber(value).padEnd(10)}${formatHMS(
               (1000 * totalAmount) / baseBuilderCapacity,
            ).padEnd(10)}${cost}`;
            wonderCost.push(cost);
         }
      });

   const resourcePrice: string[] = [];
   keysOf(Config.Resource)
      .sort((a, b) => Config.ResourceTier[a]! - Config.ResourceTier[b]!)
      .forEach((r) => {
         resourcePrice.push(
            `${r.padEnd(15)}${!NoPrice[r] && endResources[r] ? "*".padEnd(5) : "".padEnd(5)}${numberToRoman(
               Config.ResourceTier[r]!,
            )!.padEnd(10)}${formatNumber(Config.ResourcePrice[r]!).padEnd(10)}${
               resourcesUsedByWonder.get(r) ?? "0*"
            }`,
         );
      });

   const boostedBuildings = new Set<Building>();
   const notBoostedBuildings: { building: Building; tech: Tech; age: TechAge }[] = [];
   forEach(Config.GreatPerson, (p, def) => {
      def.boost?.buildings.forEach((b) => {
         if (boostedBuildings.has(b)) {
            console.error(`${b} is boosted by two great people`);
         }
         boostedBuildings.add(b);
      });
   });

   const buildingInputCost: string[] = [];
   keysOf(Config.Building)
      .sort((a, b) => Config.BuildingTier[a]! - Config.BuildingTier[b]!)
      .forEach((building) => {
         const def = Config.Building[building];
         if (isSpecialBuilding(building)) {
            return;
         }
         if (!boostedBuildings.has(building)) {
            const tech = getBuildingUnlockTech(building)!;
            const age = getAgeForTech(tech)!;
            notBoostedBuildings.push({ building, tech, age });
         }
         let cost = 0;
         forEach(def.input, (res, amount) => {
            cost += Config.ResourcePrice[res]! * amount;
         });
         let construction = 0;
         forEach(def.construction, (res, amount) => {
            construction += Config.ResourcePrice[res]! * amount;
         });
         let constructionCost = "";
         if (construction > 0) {
            constructionCost = String(construction).padStart(10);
            if (construction !== cost) {
               constructionCost += "*";
            }
         }
         if (cost > 0) {
            buildingInputCost.push(
               `${def.name().padEnd(30)}${numberToRoman(Config.BuildingTier[building]!)!.padStart(10)}${round(
                  cost,
                  2,
               )
                  .toString()
                  .padStart(10)}${constructionCost}`,
            );
         }
      });

   notBoostedBuildings.sort((a, b) => Config.Tech[a.tech].column - Config.Tech[b.tech].column);

   // console.log("BuildingTier", sortTabulate(Config.BuildingTier));
   // console.log("BuildingTech", sortTabulate(Config.BuildingTech));
   // console.log("ResourceTier", sortTabulate(Config.ResourceTier));
   // console.log("ResourcePrice", sortTabulate(Config.ResourcePrice));
   // console.log("ResourceTech", sortTabulate(Config.ResourceTech));
   console.log(`>>>>>>>>>> ResourcePrice <<<<<<<<<<\n${resourcePrice.join("\n")}`);
   console.log(`>>>>>>>>>> WonderCost <<<<<<<<<<\n${wonderCost.join("\n")}`);
   console.log(
      `>>>>>>>>>> NotBoostedBuildings <<<<<<<<<<\n${notBoostedBuildings
         .map((a) => `${a.building.padEnd(25)}${a.tech.padEnd(20)}${a.age}`)
         .join("\n")}`,
   );
   console.log(`>>>>>>>>>> Building Input Cost <<<<<<<<<<\n${buildingInputCost.join("\n")}`);
}
