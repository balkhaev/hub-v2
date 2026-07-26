const WORKSPACE_ID = "ws_demo";
const ACTOR_ID = "local-user";

const timeline = document.querySelector("#timeline");
const personaFeed = document.querySelector("#persona-feed");
const personaCount = document.querySelector("#persona-count");
const dialog = document.querySelector("#persona-dialog");
const personaForm = document.querySelector("#persona-form");
const subjectType = document.querySelector("#subject-type");
const consentPanel = document.querySelector("#consent-panel");
const formError = document.querySelector("#form-error");
const selectedPersonaView = document.querySelector("#selected-persona");
const generationForm = document.querySelector("#generation-form");
const inspectorTitle = document.querySelector("#inspector-title");
const inspectorVersion = document.querySelector("#inspector-version");
const inspectorBody = document.querySelector("#inspector-body");

let personas = [];
let selectedPersona = null;

async function api(path, options = {}) {
  const response = await fetch(path, {
    ...options,
    headers: {
      "content-type": "application/json",
      "x-workspace-id": WORKSPACE_ID,
      "x-actor-id": ACTOR_ID,
      ...(options.headers ?? {}),
    },
  });
  const payload = await response.json();
  if (!response.ok) {
    throw new Error(payload.error?.message ?? "API request failed");
  }
  return payload;
}

function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function commaList(value) {
  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(",")[1]);
    reader.onerror = () => reject(reader.error ?? new Error("Не удалось прочитать файл"));
    reader.readAsDataURL(file);
  });
}

function appendAgentMessage(text) {
  const article = element("article", "message system-message");
  article.append(element("div", "avatar agent", "P"));
  const content = element("div", "message-content");
  const meta = element("div", "message-meta");
  meta.append(element("strong", "", "@producer"), element("time", "", "сейчас"));
  content.append(meta, element("p", "", text));
  article.append(content);
  personaFeed.append(article);
  article.scrollIntoView({ behavior: "smooth", block: "end" });
}

function badge(text, tone = "") {
  return element("span", `card-badge ${tone}`.trim(), text);
}

function renderPersonaCard(item) {
  const { persona, widget } = item;
  const snapshot = widget.snapshot;

  const article = element("article", "message persona-message");
  article.dataset.personaId = persona.id;
  article.append(element("div", "avatar agent visual", "V"));

  const messageContent = element("div", "message-content");
  const meta = element("div", "message-meta");
  meta.append(element("strong", "", "@visual"), element("time", "", "сейчас"));
  messageContent.append(meta, element("p", "message-lead", "Visual identity сохранена и готова к повторному использованию."));

  const card = element("section", "persona-card");
  const imageWrap = element("button", "persona-image-wrap");
  imageWrap.type = "button";
  imageWrap.setAttribute("aria-label", `Открыть ${snapshot.displayName}`);
  const image = element("img", "persona-image");
  image.src = snapshot.imageUrl;
  image.alt = `Reference photo: ${snapshot.displayName}`;
  image.loading = "lazy";
  imageWrap.append(image, badge(`v${snapshot.version}`, "image-version"));

  const body = element("div", "persona-card-body");
  const titleRow = element("div", "persona-title-row");
  const title = element("div");
  title.append(element("p", "eyebrow", "NPC card"), element("h3", "", snapshot.displayName));
  const state = element("div", "persona-state");
  state.append(
    badge(snapshot.subjectType.replaceAll("_", " ")),
    badge(snapshot.consentStatus, snapshot.consentStatus === "verified" ? "success" : ""),
  );
  titleRow.append(title, state);

  const description = element(
    "p",
    "persona-description",
    snapshot.visualDescription || "Описание пока не задано — identity держится на source reference.",
  );

  const traits = element("div", "trait-list");
  const traitValues = snapshot.immutableTraits.length
    ? snapshot.immutableTraits
    : ["source-photo anchored"];
  for (const trait of traitValues.slice(0, 5)) traits.append(badge(trait, "trait"));

  const provenance = element("div", "provenance-row");
  provenance.append(
    element("span", "", `${snapshot.referenceCount} reference`),
    element("span", "mono", snapshot.reference.sha256.slice(0, 10)),
  );

  const actions = element("div", "card-actions");
  const useButton = element("button", "primary-button compact", "Использовать");
  useButton.type = "button";
  useButton.addEventListener("click", () => selectPersona(item));
  const inspectButton = element("button", "secondary-button compact", "Lineage");
  inspectButton.type = "button";
  inspectButton.addEventListener("click", () => inspectPersona(item));
  actions.append(useButton, inspectButton);

  body.append(titleRow, description, traits, provenance, actions);
  card.append(imageWrap, body);
  messageContent.append(card);
  article.append(messageContent);
  imageWrap.addEventListener("click", () => inspectPersona(item));
  return article;
}

function selectPersona(item) {
  selectedPersona = item;
  selectedPersonaView.hidden = false;
  selectedPersonaView.replaceChildren();
  const image = element("img");
  image.src = item.widget.snapshot.imageUrl;
  image.alt = "";
  const label = element("span");
  label.append("Generation persona: ", element("strong", "", item.persona.displayName));
  const remove = element("button", "", "×");
  remove.type = "button";
  remove.setAttribute("aria-label", "Убрать персонажа");
  remove.addEventListener("click", () => {
    selectedPersona = null;
    selectedPersonaView.hidden = true;
  });
  selectedPersonaView.append(image, label, remove);
  document.querySelector("#generation-prompt").focus();
  inspectPersona(item);
}

function inspectorRow(label, value, mono = false) {
  const row = element("div", "inspector-row");
  row.append(element("span", "", label), element("strong", mono ? "mono" : "", value || "—"));
  return row;
}

function inspectPersona(item) {
  const { persona, primaryReference } = item;
  inspectorTitle.textContent = persona.displayName;
  inspectorVersion.textContent = `v${persona.version}`;
  inspectorBody.replaceChildren();

  const image = element("img", "inspector-image");
  image.src = primaryReference.imageUrl;
  image.alt = persona.displayName;
  inspectorBody.append(image);

  const section = element("section", "inspector-section");
  section.append(
    element("h3", "", "Identity lineage"),
    inspectorRow("Persona ID", persona.id, true),
    inspectorRow("Reference ID", primaryReference.id, true),
    inspectorRow("SHA-256", primaryReference.asset.sha256.slice(0, 18), true),
    inspectorRow("Subject", persona.subjectType),
    inspectorRow("Consent", persona.consent.status),
    inspectorRow("References", String(persona.referenceIds.length)),
  );
  inspectorBody.append(section);

  const anchors = element("section", "inspector-section");
  anchors.append(element("h3", "", "Immutable anchors"));
  if (persona.visualProfile.immutableTraits.length === 0) {
    anchors.append(element("p", "muted", "Source photo is the only anchor in this version."));
  } else {
    const list = element("div", "stacked-tags");
    persona.visualProfile.immutableTraits.forEach((trait) => list.append(badge(trait, "trait")));
    anchors.append(list);
  }
  inspectorBody.append(anchors);
}

function renderGenerationWidget(payload) {
  const snapshot = payload.widget.snapshot;
  const article = element("article", "message generation-message");
  article.append(element("div", "avatar agent visual", "V"));
  const content = element("div", "message-content");
  const meta = element("div", "message-meta");
  meta.append(element("strong", "", "@visual"), element("time", "", "сейчас"));
  const card = element("section", "generation-card");
  const top = element("div", "generation-top");
  const title = element("div");
  title.append(element("p", "eyebrow", "Generation request"), element("h3", "", snapshot.prompt));
  top.append(title, badge(snapshot.status.replaceAll("_", " "), "success"));
  const stats = element("div", "generation-stats");
  stats.append(
    inspectorRow("Output", `${snapshot.outputType} · ${snapshot.aspectRatio}`),
    inspectorRow("Workflow", snapshot.workflowId, true),
    inspectorRow("Persona", snapshot.personas[0]?.displayName ?? "—"),
    inspectorRow("Reference", snapshot.personas[0]?.referenceSha256.slice(0, 12) ?? "—", true),
  );
  const notice = element(
    "p",
    "generation-notice",
    "Snapshot зафиксирован. Смена primary photo у NPC не изменит этот запрос. Runpod dispatch будет подключён следующим адаптером.",
  );
  card.append(top, stats, notice);
  content.append(meta, card);
  article.append(content);
  personaFeed.append(article);
  article.scrollIntoView({ behavior: "smooth", block: "end" });
}

async function loadPersonas() {
  personaFeed.append(document.querySelector("#loading-template").content.cloneNode(true));
  try {
    const payload = await api("/api/v1/personas");
    personas = payload.items;
    personaFeed.replaceChildren();
    personaCount.textContent = String(personas.length);
    if (personas.length === 0) {
      const empty = element("section", "empty-feed");
      empty.append(
        element("div", "empty-icon", "◇"),
        element("h2", "", "Пока нет персонажей"),
        element("p", "", "Создайте первую NPC-карточку из исходной фотографии."),
      );
      const button = element("button", "primary-button", "+ Добавить NPC");
      button.type = "button";
      button.addEventListener("click", () => dialog.showModal());
      empty.append(button);
      personaFeed.append(empty);
      return;
    }
    personas.forEach((item) => personaFeed.append(renderPersonaCard(item)));
  } catch (error) {
    personaFeed.replaceChildren();
    appendAgentMessage(`Не удалось загрузить NPC-карточки: ${error.message}`);
  }
}

document.querySelector("#open-persona-dialog").addEventListener("click", () => {
  formError.hidden = true;
  dialog.showModal();
});

subjectType.addEventListener("change", () => {
  consentPanel.hidden = subjectType.value !== "consenting_adult";
});

personaForm.addEventListener("submit", async (event) => {
  if (event.submitter?.value === "cancel") return;
  event.preventDefault();
  formError.hidden = true;
  const saveButton = document.querySelector("#save-persona");
  saveButton.disabled = true;
  saveButton.textContent = "Сохраняю…";

  try {
    const file = document.querySelector("#source-image").files[0];
    if (!file) throw new Error("Выберите исходное фото");
    const type = subjectType.value;
    const body = {
      displayName: document.querySelector("#display-name").value,
      subjectType: type,
      visualDescription: document.querySelector("#visual-description").value,
      immutableTraits: commaList(document.querySelector("#immutable-traits").value),
      negativeTraits: commaList(document.querySelector("#negative-traits").value),
      consent:
        type === "consenting_adult"
          ? {
              status: "attested",
              ageConfirmed: document.querySelector("#age-confirmed").checked,
              basis: document.querySelector("#consent-basis").value,
              attestedBy: document.querySelector("#attested-by").value,
            }
          : { status: "not_required", ageConfirmed: false },
      sourceImage: {
        contentType: file.type,
        dataBase64: await fileToBase64(file),
        fileName: file.name,
        label: "Primary reference",
      },
    };

    const payload = await api("/api/v1/personas", {
      method: "POST",
      body: JSON.stringify(body),
    });
    personas.unshift(payload);
    personaCount.textContent = String(personas.length);
    const empty = personaFeed.querySelector(".empty-feed");
    if (empty) empty.remove();
    personaFeed.prepend(renderPersonaCard(payload));
    dialog.close();
    personaForm.reset();
    consentPanel.hidden = true;
    appendAgentMessage(`${payload.persona.displayName} сохранён как reusable visual identity.`);
    selectPersona(payload);
  } catch (error) {
    formError.textContent = error.message;
    formError.hidden = false;
  } finally {
    saveButton.disabled = false;
    saveButton.textContent = "Сохранить карточку";
  }
});

generationForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const prompt = document.querySelector("#generation-prompt").value.trim();
  if (!selectedPersona) {
    appendAgentMessage("Сначала выберите NPC-карточку кнопкой «Использовать». ");
    return;
  }
  if (!prompt) return;

  const button = generationForm.querySelector("button[type=submit]");
  button.disabled = true;
  try {
    const payload = await api("/api/v1/generations", {
      method: "POST",
      body: JSON.stringify({
        prompt,
        outputType: document.querySelector("#output-type").value,
        aspectRatio: document.querySelector("#aspect-ratio").value,
        count: 1,
        personaBindings: [
          {
            personaId: selectedPersona.persona.id,
            role: "subject",
            referenceStrength: 0.8,
            preserveFace: true,
          },
        ],
      }),
    });
    renderGenerationWidget(payload);
    document.querySelector("#generation-prompt").value = "";
  } catch (error) {
    appendAgentMessage(`Generation request не создан: ${error.message}`);
  } finally {
    button.disabled = false;
  }
});

loadPersonas();
