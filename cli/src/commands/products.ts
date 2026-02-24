import { Command } from "commander";
import { readFileSync } from "fs";
import { apiGet, apiPost, apiPatch, apiDelete } from "../lib/api.ts";
import { getConfig } from "../lib/config.ts";
import {
  outputResult,
  outputError,
  outputSuccess,
  formatTable,
  extractResults,
} from "../lib/output.ts";
import {
  confirmCreate,
  confirmUpdate,
  confirmDelete,
  getConfirmOptions,
} from "../lib/confirm.ts";

function resolvePopupId(options: any): string | undefined {
  return options.popup || getConfig("popup_id");
}

export function registerProductCommands(program: Command): void {
  const productsCmd = program
    .command("products")
    .description("Manage products");

  productsCmd
    .command("list")
    .description("List products")
    .option("--popup <id>", "Popup ID (or use configured popup_id)")
    .option("--category <category>", "Filter by category")
    .option("--active <boolean>", "Filter by active status")
    .option("--search <query>", "Search products")
    .option("--sort-by <field>", "Sort by field")
    .option("--sort-order <order>", "Sort order (asc/desc)")
    .option("--limit <n>", "Limit results")
    .option("--skip <n>", "Skip results")
    .action(async (options, cmd) => {
      const jsonOutput = cmd.optsWithGlobals().json;
      try {
        const popupId = resolvePopupId(options);
        if (!popupId) {
          outputError(
            "Popup ID is required. Use --popup or set via `edgeos config set popup_id <id>`"
          );
          process.exit(1);
        }

        const params: Record<string, string | number | boolean | undefined> = {
          popup_id: popupId,
          category: options.category,
          is_active: options.active,
          search: options.search,
          sort_by: options.sortBy,
          sort_order: options.sortOrder,
          limit: options.limit ? Number(options.limit) : undefined,
          skip: options.skip ? Number(options.skip) : undefined,
        };

        const products = await apiGet("/api/v1/products", params);

        if (jsonOutput) {
          outputResult(products, { json: true });
        } else {
          const rows = extractResults(products).map(
            (p: any) => ({
              id: p.id,
              name: p.name,
              price: p.price,
              category: p.category,
              active: p.is_active,
              slug: p.slug,
            })
          );
          process.stdout.write(
            formatTable(rows, ["id", "name", "price", "category", "active", "slug"]) + "\n"
          );
        }
      } catch (err: any) {
        outputError(err.message || "Failed to list products");
        process.exit(1);
      }
    });

  productsCmd
    .command("get <id>")
    .description("Get product details")
    .action(async (id: string, _, cmd) => {
      const jsonOutput = cmd.optsWithGlobals().json;
      try {
        const product = await apiGet(`/api/v1/products/${id}`);
        outputResult(product, { json: !!jsonOutput });
      } catch (err: any) {
        outputError(err.message || "Failed to get product");
        process.exit(1);
      }
    });

  productsCmd
    .command("create")
    .description("Create a new product")
    .option("--popup <id>", "Popup ID (or use configured popup_id)")
    .requiredOption("--name <name>", "Product name")
    .requiredOption("--price <price>", "Product price")
    .option("--slug <slug>", "Product slug")
    .option("--description <description>", "Product description")
    .option(
      "--category <category>",
      "Category (ticket/housing/merch/other/patreon)"
    )
    .option(
      "--attendee-category <category>",
      "Attendee category (main/spouse/kid)"
    )
    .option(
      "--duration-type <type>",
      "Duration type (day/week/month/full)"
    )
    .option("--start-date <date>", "Start date")
    .option("--end-date <date>", "End date")
    .option("--active <boolean>", "Is active")
    .option("--exclusive <boolean>", "Is exclusive")
    .option("--max-quantity <n>", "Max quantity")
    .action(async (options, cmd) => {
      const jsonOutput = cmd.optsWithGlobals().json;
      const confirmOpts = getConfirmOptions(cmd);
      try {
        const popupId = resolvePopupId(options);
        if (!popupId) {
          outputError(
            "Popup ID is required. Use --popup or set via `edgeos config set popup_id <id>`"
          );
          process.exit(1);
        }

        const body: Record<string, any> = {
          popup_id: popupId,
          name: options.name,
          price: Number(options.price),
        };

        if (options.slug !== undefined) body.slug = options.slug;
        if (options.description !== undefined)
          body.description = options.description;
        if (options.category !== undefined) body.category = options.category;
        if (options.attendeeCategory !== undefined)
          body.attendee_category = options.attendeeCategory;
        if (options.durationType !== undefined)
          body.duration_type = options.durationType;
        if (options.startDate !== undefined) body.start_date = options.startDate;
        if (options.endDate !== undefined) body.end_date = options.endDate;
        if (options.active !== undefined)
          body.is_active = options.active === "true";
        if (options.exclusive !== undefined)
          body.exclusive = options.exclusive === "true";
        if (options.maxQuantity !== undefined)
          body.max_quantity = Number(options.maxQuantity);

        const { confirmed } = await confirmCreate("product", body, confirmOpts);
        if (!confirmed) return;

        const product = await apiPost("/api/v1/products", body);

        if (jsonOutput) {
          outputResult(product, { json: true });
        } else {
          outputSuccess(`Product created: ${product.id}`);
        }
      } catch (err: any) {
        outputError(err.message || "Failed to create product");
        process.exit(1);
      }
    });

  productsCmd
    .command("update <id>")
    .description("Update a product")
    .option("--name <name>", "Product name")
    .option("--price <price>", "Product price")
    .option("--slug <slug>", "Product slug")
    .option("--description <description>", "Product description")
    .option(
      "--category <category>",
      "Category (ticket/housing/merch/other/patreon)"
    )
    .option(
      "--attendee-category <category>",
      "Attendee category (main/spouse/kid)"
    )
    .option(
      "--duration-type <type>",
      "Duration type (day/week/month/full)"
    )
    .option("--start-date <date>", "Start date")
    .option("--end-date <date>", "End date")
    .option("--active <boolean>", "Is active")
    .option("--exclusive <boolean>", "Is exclusive")
    .option("--max-quantity <n>", "Max quantity")
    .action(async (id: string, options, cmd) => {
      const jsonOutput = cmd.optsWithGlobals().json;
      const confirmOpts = getConfirmOptions(cmd);
      try {
        const body: Record<string, any> = {};

        if (options.name !== undefined) body.name = options.name;
        if (options.price !== undefined) body.price = Number(options.price);
        if (options.slug !== undefined) body.slug = options.slug;
        if (options.description !== undefined)
          body.description = options.description;
        if (options.category !== undefined) body.category = options.category;
        if (options.attendeeCategory !== undefined)
          body.attendee_category = options.attendeeCategory;
        if (options.durationType !== undefined)
          body.duration_type = options.durationType;
        if (options.startDate !== undefined) body.start_date = options.startDate;
        if (options.endDate !== undefined) body.end_date = options.endDate;
        if (options.active !== undefined)
          body.is_active = options.active === "true";
        if (options.exclusive !== undefined)
          body.exclusive = options.exclusive === "true";
        if (options.maxQuantity !== undefined)
          body.max_quantity = Number(options.maxQuantity);

        const { confirmed } = await confirmUpdate(
          `/api/v1/products/${id}`,
          "product",
          body,
          confirmOpts
        );
        if (!confirmed) return;

        const product = await apiPatch(`/api/v1/products/${id}`, body);

        if (jsonOutput) {
          outputResult(product, { json: true });
        } else {
          outputSuccess(`Product updated: ${id}`);
        }
      } catch (err: any) {
        outputError(err.message || "Failed to update product");
        process.exit(1);
      }
    });

  productsCmd
    .command("delete <id>")
    .description("Delete a product")
    .action(async (id: string, _, cmd) => {
      const confirmOpts = getConfirmOptions(cmd);
      try {
        const { confirmed } = await confirmDelete(
          `/api/v1/products/${id}`,
          "product",
          confirmOpts
        );
        if (!confirmed) return;

        await apiDelete(`/api/v1/products/${id}`);
        outputSuccess(`Product deleted: ${id}`);
      } catch (err: any) {
        outputError(err.message || "Failed to delete product");
        process.exit(1);
      }
    });

  productsCmd
    .command("import <file>")
    .description("Batch import products from a JSON file")
    .option("--popup <id>", "Popup ID (or use configured popup_id)")
    .action(async (file: string, options, cmd) => {
      const jsonOutput = cmd.optsWithGlobals().json;
      const confirmOpts = getConfirmOptions(cmd);
      try {
        const popupId = resolvePopupId(options);
        if (!popupId) {
          outputError(
            "Popup ID is required. Use --popup or set via `edgeos config set popup_id <id>`"
          );
          process.exit(1);
        }

        const raw = readFileSync(file, "utf-8");
        const data = JSON.parse(raw);

        let products: any[];
        if (Array.isArray(data)) {
          products = data;
        } else if (data.products && Array.isArray(data.products)) {
          products = data.products;
        } else {
          outputError(
            "Invalid file format. Expected an array of products or { popup_id, products: [...] }"
          );
          process.exit(1);
        }

        const body = {
          popup_id: popupId,
          products,
        };

        const { confirmed } = await confirmCreate("product import", body, confirmOpts);
        if (!confirmed) return;

        const result = await apiPost("/api/v1/products/batch", body);

        if (jsonOutput) {
          outputResult(result, { json: true });
        } else {
          outputSuccess(
            `Imported ${products.length} products`
          );
        }
      } catch (err: any) {
        outputError(err.message || "Failed to import products");
        process.exit(1);
      }
    });
}
