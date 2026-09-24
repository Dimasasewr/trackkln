(() => {
  const CFG = window.KARSA_CONFIG || {};
  const hasSupabase = Boolean(
    CFG.SUPABASE_URL &&
    CFG.SUPABASE_KEY &&
    window.supabase
  );

  const client = hasSupabase
    ? window.supabase.createClient(
        CFG.SUPABASE_URL,
        CFG.SUPABASE_KEY
      )
    : null;

  let state = {
    user: null,
    jobs: [],
    activities: [],
    currentView: "dashboard",
    filterText: "",
    filterStatus: "",
    filterDivision: ""
  };

  const $ = id => document.getElementById(id);

  const today = () =>
    new Date().toISOString().slice(0, 10);

  const esc = s =>
    String(s ?? "").replace(
      /[&<>"']/g,
      m =>
        ({
          "&": "&amp;",
          "<": "&lt;",
          ">": "&gt;",
          '"': "&quot;",
          "'": "&#039;"
        })[m]
    );

  const initials = name =>
    String(name || "")
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map(x => x[0])
      .join("")
      .toUpperCase() || "K";

  const roleLabel = role =>
    ({
      director: "Director",
      general_manager: "General Manager",
      operational_head: "Head Divisi Operasional",
      division_head: "Head Divisi",
      staff: "Staff"
    })[role] || role;

  const dateFmt = d =>
    d
      ? new Intl.DateTimeFormat("id-ID", {
          day: "2-digit",
          month: "short",
          year: "numeric"
        }).format(new Date(d + "T00:00:00"))
      : "—";

  const statusClass = s =>
    s === "Selesai"
      ? "done"
      : s === "Terkendala"
      ? "blocked"
      : s === "Siap Review"
      ? "review"
      : s === "Menunggu"
      ? "wait"
      : "";

  /*
   * =========================================================
   * HAK AKSES
   * =========================================================
   *
   * Director:
   * - Bisa memberikan jobdesk
   * - Bisa melihat seluruh pekerjaan
   *
   * General Manager:
   * - Bisa memberikan jobdesk
   * - Bisa melihat seluruh pekerjaan
   *
   * Head Divisi Operasional:
   * - Bisa memberikan jobdesk
   * - Bisa melihat seluruh pekerjaan
   *
   * Head Divisi / Staff:
   * - Hanya melihat pekerjaan divisinya
   *
   * Update progres:
   * - HANYA PIC yang ditunjuk
   */

  const canAssign = () =>
    [
      "director",
      "general_manager",
      "operational_head"
    ].includes(state.user?.role);

  const canMonitorAll = () =>
    [
      "director",
      "general_manager",
      "operational_head"
    ].includes(state.user?.role);

  const canEditProgress = job =>
    Boolean(
      state.user &&
      job.assigneeId === state.user.id
    );

  function canSee(job) {
    if (!state.user) return false;

    if (canMonitorAll()) {
      return true;
    }

    return (
      job.division ===
      state.user.division
    );
  }

  function visibleJobs() {
    return state.jobs.filter(canSee);
  }

  /*
   * =========================================================
   * LOAD JOBS
   * =========================================================
   */

  async function loadJobs() {
    if (client) {
      const {
        data,
        error
      } = await client
        .from("jobs")
        .select("*")
        .order("updated_at", {
          ascending: false
        });

      if (!error && data) {
        state.jobs = data.map(normalizeJob);
      } else {
        state.jobs = [];

        showToast(
          "Database belum terhubung atau tabel jobs belum dibuat."
        );
      }
    } else {
      state.jobs = JSON.parse(
        localStorage.getItem(
          "karsa_jobs"
        ) || "[]"
      );
    }
  }

  function normalizeJob(j) {
    return {
      id: j.id,

      title: j.title,

      division:
        j.assigned_division ||
        j.division,

      assigneeId:
        j.assignee_id ||
        j.assigneeId ||
        "",

      assignee:
        j.assignee_name ||
        j.assignee ||
        "",

      deadline: j.deadline,

      progress: Number(
        j.progress || 0
      ),

      status:
        j.status ||
        "Belum Mulai",

      priority:
        j.priority ||
        "Normal",

      description:
        j.description ||
        "",

      blocker:
        j.blocker ||
        "",

      nextAction:
        j.next_action ||
        j.nextAction ||
        "",

      createdBy:
        j.created_by ||
        "",

      updated:
        j.updated_at
          ? new Date(
              j.updated_at
            ).toLocaleString(
              "id-ID",
              {
                day: "2-digit",
                month: "short",
                hour: "2-digit",
                minute: "2-digit"
              }
            )
          : "—"
    };
  }

  /*
   * =========================================================
   * UPDATE JOB
   * =========================================================
   */

  async function updateJob(
    job,
    patch
  ) {
    if (!canEditProgress(job)) {
      showToast(
        "Hanya PIC yang dipilih untuk pekerjaan ini yang dapat memperbarui progres."
      );

      return false;
    }

    const next = {
      ...job,
      ...patch
    };

    if (
      Number(next.progress) >= 100 &&
      next.status === "In Progress"
    ) {
      next.status =
        "Siap Review";
    }

    if (client) {
      const payload = {
        progress: next.progress,
        status: next.status,
        blocker: next.blocker,
        next_action:
          next.nextAction
      };

      const {
        data,
        error
      } = await client
        .from("jobs")
        .update(payload)
        .eq("id", job.id)
        .eq(
          "assignee_id",
          state.user.id
        )
        .select("*")
        .single();

      if (error) {
        showToast(
          error.message
        );

        return false;
      }

      const idx =
        state.jobs.findIndex(
          x =>
            x.id === job.id
        );

      if (idx >= 0) {
        state.jobs[idx] =
          normalizeJob(data);
      }

      await client
        .from(
          "progress_history"
        )
        .insert({
          job_id: job.id,
          progress:
            next.progress,
          status:
            next.status,
          note:
            next.nextAction ||
            next.blocker ||
            "",
          updated_by:
            state.user.id
        });
    } else {
      const idx =
        state.jobs.findIndex(
          x =>
            x.id === job.id
        );

      if (idx >= 0) {
        state.jobs[idx] =
          next;
      }

      localStorage.setItem(
        "karsa_jobs",
        JSON.stringify(
          state.jobs
        )
      );
    }

    addActivity(
      `${state.user.name} memperbarui "${next.title}"`,
      `${next.progress}% • ${next.status}`
    );

    renderAll();

    return true;
  }

  /*
   * =========================================================
   * CREATE JOB
   * =========================================================
   */

  async function createJob(data) {
    if (!canAssign()) {
      showToast(
        "Hanya Director / General Manager / Head Divisi Operasional yang dapat memberikan pekerjaan."
      );

      return false;
    }

    if (
      !data.title ||
      !data.assigneeId ||
      !data.division ||
      !data.deadline
    ) {
      showToast(
        "Lengkapi nama pekerjaan, divisi, PIC, dan deadline."
      );

      return false;
    }

    const newJob = {
      id:
        "KRS-" +
        Date.now(),

      title:
        data.title,

      division:
        data.division,

      assigneeId:
        data.assigneeId,

      assignee:
        data.assignee,

      deadline:
        data.deadline,

      progress: 0,

      status:
        "Belum Mulai",

      priority:
        data.priority,

      description:
        data.description,

      blocker: "",

      nextAction:
        data.nextAction,

      updated:
        "Baru"
    };

    if (client) {
      const {
        data: row,
        error
      } = await client
        .from("jobs")
        .insert({
          title:
            newJob.title,

          assigned_division:
            newJob.division,

          assignee_id:
            newJob.assigneeId,

          assignee_name:
            newJob.assignee,

          deadline:
            newJob.deadline,

          progress: 0,

          status:
            newJob.status,

          priority:
            newJob.priority,

          description:
            newJob.description,

          next_action:
            newJob.nextAction,

          created_by:
            state.user.id
        })
        .select("*")
        .single();

      if (error) {
        showToast(
          error.message
        );

        return false;
      }

      state.jobs.unshift(
        normalizeJob(row)
      );
    } else {
      state.jobs.unshift(
        newJob
      );

      localStorage.setItem(
        "karsa_jobs",
        JSON.stringify(
          state.jobs
        )
      );
    }

    addActivity(
      `Assignment dikirim ke ${newJob.division}`,
      `${newJob.title} → ${newJob.assignee}`
    );

    showToast(
      `Pekerjaan masuk ke ${newJob.division} • PIC: ${newJob.assignee}`
    );

    return true;
  }

  /*
   * =========================================================
   * ACTIVITY
   * =========================================================
   */

  function addActivity(
    title,
    detail
  ) {
    state.activities.unshift({
      title,
      detail,
      time: "Baru"
    });

    state.activities =
      state.activities.slice(
        0,
        8
      );

    localStorage.setItem(
      "karsa_demo_activity",
      JSON.stringify(
        state.activities
      )
    );
  }

  function loadActivities() {
    state.activities =
      JSON.parse(
        localStorage.getItem(
          "karsa_demo_activity"
        ) || "[]"
      );

    if (
      !state.activities.length
    ) {
      state.activities = [
        {
          title:
            "Workspace initialized",

          detail:
            "KARSA Executive Work Tracker",

          time:
            "Hari ini"
        },

        {
          title:
            "Routing aktif",

          detail:
            "Assignment → divisi tujuan",

          time:
            "Hari ini"
        }
      ];
    }
  }

  /*
   * =========================================================
   * RENDER
   * =========================================================
   */

  function renderAll() {
    renderUser();
    renderDashboard();
    renderJobs();
    renderMyJobs();
    renderWeekly();
    renderActivity();
  }

  function renderUser() {
    const u =
      state.user;

    if (!u) return;

    $("sideName").textContent =
      u.name;

    $("sideRole").textContent =
      `${roleLabel(u.role)} • ${u.division}`;

    const avatarText =
      u.initials ||
      initials(u.name);

    [$("sideAvatar"), $("mobileAvatar")]
      .filter(Boolean)
      .forEach(el => {
        el.textContent = avatarText;
        el.style.backgroundImage = u.avatarUrl
          ? `url("${u.avatarUrl}")`
          : "";
        el.style.backgroundSize = "cover";
        el.style.backgroundPosition = "center";
        el.style.backgroundRepeat = "no-repeat";
        el.style.color = u.avatarUrl ? "transparent" : "";
      });

    $("welcomeText").textContent =
      `${u.title || roleLabel(u.role)} • ${u.division}. Pantau pekerjaan yang berjalan dan pastikan next action selalu jelas.`;

    document
      .querySelectorAll(
        ".ops-only"
      )
      .forEach(el => {
        el.classList.toggle(
          "hidden",
          !canAssign()
        );
      });

    $("connectionText").textContent =
      client
        ? "Supabase connected"
        : "Preview mode";
  }

  /*
   * =========================================================
   * DASHBOARD
   * =========================================================
   */

  function renderDashboard() {
    const jobs =
      visibleJobs();

    const total =
      jobs.length;

    const progress =
      jobs.filter(
        j =>
          j.status ===
          "In Progress"
      ).length;

    const review =
      jobs.filter(
        j =>
          j.status ===
          "Siap Review"
      ).length;

    const blocked =
      jobs.filter(
        j =>
          j.status ===
          "Terkendala"
      ).length;

    const late =
      jobs.filter(
        j =>
          j.deadline &&
          j.deadline <
            today() &&
          j.status !==
            "Selesai"
      ).length;

    $("statTotal").textContent =
      total;

    $("statProgress").textContent =
      progress;

    $("statReview").textContent =
      review;

    $("statBlocked").textContent =
      blocked;

    $("statLate").textContent =
      late;

    const avg =
      total
        ? Math.round(
            jobs.reduce(
              (a, j) =>
                a +
                j.progress,
              0
            ) / total
          )
        : 0;

    $("heroProgress").textContent =
      avg + "%";

    const attention =
      jobs
        .filter(
          j =>
            j.status ===
              "Terkendala" ||
            (
              j.deadline <
                today() &&
              j.status !==
                "Selesai"
            ) ||
            j.status ===
              "Siap Review"
        )
        .slice(0, 5);

    $("attentionList").innerHTML =
      attention.length
        ? attention
            .map(
              j =>
                `<div class="attention-item">
                  <span class="bar ${
                    j.status ===
                    "Terkendala"
                      ? "red"
                      : ""
                  }"></span>
                  <div>
                    <strong>${esc(
                      j.title
                    )}</strong>
                    <small>
                      ${esc(
                        j.division
                      )} •
                      ${esc(
                        j.assignee
                      )} •
                      ${dateFmt(
                        j.deadline
                      )}
                    </small>
                  </div>
                  <span class="pct">
                    ${j.progress}%
                  </span>
                </div>`
            )
            .join("")
        : `<div class="empty">
            <div>✓</div>
            <h3>Tidak ada item kritis</h3>
            <p>
              Semua pekerjaan terlihat terkendali dari akun ini.
            </p>
          </div>`;

    const divisions = [
      "Finance",
      "IT",
      "Operasional",
      "R&D"
    ];

    $("divisionPulse").innerHTML =
      divisions
        .map(d => {
          const a =
            jobs.filter(
              j =>
                j.division ===
                d
            );

          const p =
            a.length
              ? Math.round(
                  a.reduce(
                    (x, j) =>
                      x +
                      j.progress,
                    0
                  ) /
                    a.length
                )
              : 0;

          return `
            <div class="division-row">
              <div class="division-label">
                <span>${d}</span>
                <span>
                  ${a.length} job • ${p}%
                </span>
              </div>

              <div class="division-track">
                <span
                  style="width:${p}%"
                ></span>
              </div>
            </div>
          `;
        })
        .join("");
  }

  /*
   * =========================================================
   * FILTER
   * =========================================================
   */

  function filteredJobs() {
    const q =
      state.filterText
        .toLowerCase();

    return visibleJobs().filter(
      j =>
        (
          !q ||
          `${j.title} ${j.assignee} ${j.division}`
            .toLowerCase()
            .includes(q)
        ) &&
        (
          !state.filterStatus ||
          j.status ===
            state.filterStatus
        ) &&
        (
          !state.filterDivision ||
          j.division ===
            state.filterDivision
        )
    );
  }

  /*
   * =========================================================
   * JOB TABLE
   * =========================================================
   */

  function renderJobs() {
    const jobs =
      filteredJobs();

    $("jobRows").innerHTML =
      jobs
        .map(
          j =>
            `<tr>
              <td>
                <strong>${esc(
                  j.title
                )}</strong>
                <small>
                  ${esc(
                    j.description
                  ).slice(
                    0,
                    80
                  )}
                </small>
              </td>

              <td>
                <strong>${esc(
                  j.division
                )}</strong>
                <small>
                  ${esc(
                    j.assignee
                  )}
                </small>
              </td>

              <td>
                ${dateFmt(
                  j.deadline
                )}

                ${
                  j.deadline <
                    today() &&
                  j.status !==
                    "Selesai"
                    ? `<small style="color:#d87979">
                        Lewat deadline
                      </small>`
                    : ""
                }
              </td>

              <td class="progress-cell">
                <div class="progress-top">
                  <span>
                    PROGRESS
                  </span>

                  <b>
                    ${j.progress}%
                  </b>
                </div>

                <div class="progress-track">
                  <span
                    style="width:${j.progress}%"
                  ></span>
                </div>
              </td>

              <td>
                <span class="status ${statusClass(
                  j.status
                )}">
                  ${esc(
                    j.status
                  )}
                </span>
              </td>

              <td>
                <button
                  class="row-action"
                  data-open-job="${j.id}"
                >
                  Buka
                </button>
              </td>
            </tr>`
        )
        .join("");

    $("jobEmpty").classList.toggle(
      "hidden",
      jobs.length > 0
    );
  }

  /*
   * =========================================================
   * MY JOBS
   * =========================================================
   */

  function renderMyJobs() {
    const jobs =
      visibleJobs().filter(
        j =>
          j.assigneeId ===
          state.user.id
      );

    $("myJobsGrid").innerHTML =
      jobs.length
        ? jobs
            .map(
              j =>
                `<article class="job-card">

                  <div class="card-meta">
                    <span class="status ${statusClass(
                      j.status
                    )}">
                      ${esc(
                        j.status
                      )}
                    </span>

                    <small style="color:#777">
                      ${esc(
                        j.priority
                      )}
                    </small>
                  </div>

                  <h3>
                    ${esc(
                      j.title
                    )}
                  </h3>

                  <p>
                    ${esc(
                      j.description ||
                        "Tidak ada deskripsi."
                    )}
                  </p>

                  <div class="deadline">
                    DEADLINE •
                    ${dateFmt(
                      j.deadline
                    )}
                  </div>

                  <div class="progress-top">
                    <span>
                      PROGRESS
                    </span>

                    <b>
                      ${j.progress}%
                    </b>
                  </div>

                  <div class="progress-track">
                    <span
                      style="width:${j.progress}%"
                    ></span>
                  </div>

                  <div class="next">
                    <b>
                      Next action
                    </b>

                    ${esc(
                      j.nextAction ||
                        "Belum ditentukan"
                    )}
                  </div>

                  <div class="card-bottom">

                    <small style="color:#666">
                      ${esc(
                        j.division
                      )}
                    </small>

                    <button
                      class="row-action"
                      data-open-job="${j.id}"
                    >
                      Update →
                    </button>

                  </div>

                </article>`
            )
            .join("")
        : `<div
            class="empty"
            style="grid-column:1/-1"
          >
            <div>◇</div>

            <h3>
              Queue kosong
            </h3>

            <p>
              Tidak ada pekerjaan yang ditugaskan ke akun ini.
            </p>
          </div>`;
  }

  /*
   * =========================================================
   * WEEKLY
   * =========================================================
   */

  function renderWeekly() {
    const jobs =
      visibleJobs();

    const avg =
      jobs.length
        ? Math.round(
            jobs.reduce(
              (a, j) =>
                a +
                j.progress,
              0
            ) /
              jobs.length
          )
        : 0;

    $("weeklyPercent").textContent =
      avg + "%";

    const counts = [
      "Belum Mulai",
      "In Progress",
      "Menunggu",
      "Terkendala",
      "Siap Review",
      "Selesai"
    ].map(
      s => [
        s,
        jobs.filter(
          j =>
            j.status === s
        ).length
      ]
    );

    $("weeklyStatus").innerHTML =
      counts
        .map(
          ([s, n]) =>
            `<div class="summary-line">
              <span>${s}</span>
              <span>${n}</span>
            </div>`
        )
        .join("");

    const follow =
      jobs
        .filter(
          j =>
            j.status ===
              "Terkendala" ||
            j.status ===
              "Siap Review" ||
            j.deadline <
              today()
        )
        .slice(0, 7);

    $("weeklyFollowup").innerHTML =
      follow.length
        ? follow
            .map(
              j =>
                `<div class="follow-item">
                  <strong>
                    ${esc(
                      j.title
                    )}
                  </strong>

                  <small>
                    ${esc(
                      j.division
                    )} •
                    ${esc(
                      j.status
                    )} •
                    ${esc(
                      j.nextAction ||
                        j.blocker ||
                        "Follow-up diperlukan"
                    )}
                  </small>
                </div>`
            )
            .join("")
        : `<div class="empty">
            <div>✓</div>
            <h3>
              Belum ada follow-up
            </h3>
          </div>`;

    const bars = [
      ["M", 0.55],
      ["T", 0.68],
      ["W", 0.72],
      ["T", 0.77],
      ["F", avg / 100],
      ["S", 0.35],
      ["M", 0.22]
    ];

    $("weekBars").innerHTML =
      bars
        .map(
          ([d, p]) =>
            `<div class="week-bar">
              <span
                style="height:${Math.max(
                  8,
                  p * 100
                )}px"
              ></span>

              <small>
                ${d}
              </small>
            </div>`
        )
        .join("");
  }

  /*
   * =========================================================
   * ACTIVITY
   * =========================================================
   */

  function renderActivity() {
    $("activityList").innerHTML =
      state.activities
        .map(
          a =>
            `<div class="activity-item">

              <div class="activity-icon">
                ✦
              </div>

              <div>
                <strong>
                  ${esc(
                    a.title
                  )}
                </strong>

                <small>
                  ${esc(
                    a.detail
                  )}
                </small>
              </div>

              <span class="activity-time">
                ${esc(
                  a.time
                )}
              </span>

            </div>`
        )
        .join("");
  }

  /*
   * =========================================================
   * VIEW
   * =========================================================
   */

  function showView(view) {
    state.currentView =
      view;

    document
      .querySelectorAll(
        ".view"
      )
      .forEach(v =>
        v.classList.remove(
          "active"
        )
      );

    $("view-" + view)
      ?.classList.add(
        "active"
      );

    document
      .querySelectorAll(
        ".nav-item"
      )
      .forEach(n =>
        n.classList.toggle(
          "active",
          n.dataset.view ===
            view
        )
      );

    const titles = {
      dashboard: [
        "EXECUTIVE WORKSPACE",
        "Overview"
      ],

      jobs: [
        "WORK REGISTER",
        "Pekerjaan"
      ],

      myjobs: [
        "PERSONAL QUEUE",
        "Pekerjaan Saya"
      ],

      create: [
        "ASSIGNMENT DESK",
        "Berikan Pekerjaan"
      ],

      weekly: [
        "WEEKLY REVIEW",
        "Evaluasi Mingguan"
      ],

      structure: [
        "ORGANIZATION",
        "Struktur Akses"
      ]
    };

    $("pageEyebrow").textContent =
      titles[view]?.[0] ||
      "KARSA";

    $("pageTitle").textContent =
      titles[view]?.[1] ||
      "Workspace";

    closeKarsaSidebar();
  }

  /*
   * =========================================================
   * JOB MODAL
   * =========================================================
   */

  function openJob(jobId) {
    const j =
      state.jobs.find(
        x =>
          x.id === jobId
      );

    if (!j) return;

    const editable =
      canEditProgress(j);

    $("modalTitle").textContent =
      j.title;

    $("modalBody").innerHTML = `
      <div class="update-info">

        <strong>
          ${esc(
            j.division
          )} •
          ${esc(
            j.assignee
          )}
        </strong>

        <small>
          Deadline
          ${dateFmt(
            j.deadline
          )}
          • Prioritas
          ${esc(
            j.priority
          )}
        </small>

      </div>

      <div class="update-grid">

        <label>
          Progress (%)

          <input
            id="uProgress"
            type="number"
            min="0"
            max="100"
            value="${j.progress}"
            ${
              editable
                ? ""
                : "disabled"
            }
          >
        </label>

        <label>
          Status

          <select
            id="uStatus"
            ${
              editable
                ? ""
                : "disabled"
            }
          >

            ${
              [
                "Belum Mulai",
                "In Progress",
                "Menunggu",
                "Terkendala",
                "Siap Review",
                "Selesai"
              ]
                .map(
                  s =>
                    `<option ${
                      s ===
                      j.status
                        ? "selected"
                        : ""
                    }>
                      ${s}
                    </option>`
                )
                .join("")
            }

          </select>
        </label>

        <label class="wide">
          Kendala

          <textarea
            id="uBlocker"
            rows="3"
            ${
              editable
                ? ""
                : "disabled"
            }
          >${esc(
            j.blocker
          )}</textarea>
        </label>

        <label class="wide">
          Next action / kebutuhan follow-up

          <textarea
            id="uNext"
            rows="3"
            ${
              editable
                ? ""
                : "disabled"
            }
          >${esc(
            j.nextAction
          )}</textarea>
        </label>

      </div>

      <div class="update-creator" id="updateCreator">
        <span class="update-creator-label">DIBUAT OLEH</span>
        <strong id="updateCreatorName">Memuat...</strong>
      </div>

      <div class="form-actions" id="updateFormActions">
        <button class="btn-ghost" data-close-modal type="button">Tutup</button>
        ${editable ? `<button id="saveUpdate" class="btn-gold" type="button">Simpan update →</button>` : ""}
      </div>
    `;

    $("jobModal").classList.remove(
      "hidden"
    );
    document.body.classList.add("karsa-job-open");

    // Tampilkan siapa yang membuat/menugaskan job ini.
    const creatorEl = $("updateCreatorName");
    if (creatorEl) {
      creatorEl.textContent = "Memuat...";
      if (client && j.createdBy) {
        client.from("profiles").select("name,title,division").eq("id", j.createdBy).maybeSingle().then(creatorQuery => {
          if ($("updateCreatorName")) $("updateCreatorName").textContent = creatorQuery.data?.name || "KARSA Management";
        }).catch(() => { if ($("updateCreatorName")) $("updateCreatorName").textContent = "KARSA Management"; });
      } else {
        creatorEl.textContent = "KARSA Management";
      }
    }

    $("saveUpdate")
      ?.addEventListener(
        "click",
        async () => {
          const ok =
            await updateJob(
              j,
              {
                progress:
                  Number(
                    $(
                      "uProgress"
                    ).value
                  ),

                status:
                  $(
                    "uStatus"
                  ).value,

                blocker:
                  $(
                    "uBlocker"
                  ).value,

                nextAction:
                  $(
                    "uNext"
                  ).value
              }
            );

          if (ok) {
            closeModal();

            showToast(
              "Update tersimpan."
            );
          }
        }
      );
  }

  function closeModal() {
    $("jobModal").classList.add(
      "hidden"
    );
    document.body.classList.remove("karsa-job-open");
  }

  /*
   * =========================================================
   * PROFILE
   * =========================================================
   */

  const AVATAR_BUCKET = "avatars";

  function avatarPathFromUrl(url) {
    if (!url) return "";

    const marker =
      `/storage/v1/object/public/${AVATAR_BUCKET}/`;

    const index = url.indexOf(marker);
    if (index === -1) return "";

    return decodeURIComponent(
      url.slice(index + marker.length).split("?")[0]
    );
  }

  function ensureProfileUI() {
    if ($("karsaProfileStyle")) return;

    const style = document.createElement("style");
    style.id = "karsaProfileStyle";
    style.textContent = `
      .karsa-profile-trigger { cursor:pointer !important; }
      .karsa-profile-modal {
        position:fixed; inset:0; z-index:9999;
        display:flex; align-items:center; justify-content:center;
        padding:20px; background:rgba(8,8,8,.62);
        backdrop-filter:blur(12px);
      }
      .karsa-profile-modal.hidden { display:none; }
      .karsa-profile-card {
        width:min(460px,100%); background:#fff; color:#111;
        border-radius:24px; padding:28px; box-shadow:0 30px 80px rgba(0,0,0,.28);
        animation:karsaProfileIn .24s ease both;
      }
      @keyframes karsaProfileIn { from{opacity:0;transform:translateY(12px) scale(.98)} to{opacity:1;transform:none} }
      .karsa-profile-head { display:flex; justify-content:space-between; align-items:flex-start; gap:16px; margin-bottom:24px; }
      .karsa-profile-head small { display:block; color:#9a7a3b; letter-spacing:.16em; font-size:10px; font-weight:800; margin-bottom:5px; }
      .karsa-profile-head h2 { margin:0; font-size:24px; }
      .karsa-profile-close { border:0; background:#f3f3f1; width:36px; height:36px; border-radius:50%; cursor:pointer; font-size:20px; }
      .karsa-profile-avatar-wrap { display:flex; justify-content:center; margin:4px 0 22px; }
      .karsa-profile-avatar { width:108px; height:108px; border-radius:50%; display:flex; align-items:center; justify-content:center; background:#111; color:#fff; font-size:30px; font-weight:700; background-size:cover; background-position:center; border:4px solid #fff; box-shadow:0 10px 30px rgba(0,0,0,.15); }
      .karsa-profile-actions { display:flex; justify-content:center; gap:10px; margin-bottom:24px; flex-wrap:wrap; }
      .karsa-profile-btn { border:1px solid #ddd; background:#fff; padding:10px 14px; border-radius:12px; cursor:pointer; font-weight:700; }
      .karsa-profile-btn.gold { background:#c9a45c; border-color:#c9a45c; color:#fff; }
      .karsa-profile-btn.danger { color:#b54b4b; }
      .karsa-profile-field { margin-top:14px; }
      .karsa-profile-field label { display:block; font-size:11px; font-weight:800; letter-spacing:.08em; margin-bottom:7px; color:#555; }
      .karsa-profile-field input { width:100%; box-sizing:border-box; border:1px solid #ddd; border-radius:12px; padding:12px 13px; font:inherit; outline:none; }
      .karsa-profile-field input:focus { border-color:#c9a45c; box-shadow:0 0 0 3px rgba(201,164,92,.12); }
      .karsa-profile-meta { margin-top:18px; padding:14px; background:#f7f7f5; border-radius:14px; }
      .karsa-profile-meta div { display:flex; justify-content:space-between; gap:16px; padding:5px 0; font-size:12px; }
      .karsa-profile-meta span:first-child { color:#777; }
      .karsa-profile-footer { display:flex; justify-content:flex-end; gap:10px; margin-top:22px; }
      .karsa-profile-note { font-size:11px; color:#888; text-align:center; margin-top:10px; }
      .karsa-crop-modal { position:fixed; inset:0; z-index:10001; display:flex; align-items:center; justify-content:center; padding:16px; background:rgba(5,5,5,.78); backdrop-filter:blur(14px); }
      .karsa-crop-modal.hidden { display:none; }
      .karsa-crop-card { width:min(520px,100%); background:#fff; color:#111; border-radius:24px; padding:20px; box-shadow:0 30px 90px rgba(0,0,0,.4); }
      .karsa-crop-head { display:flex; align-items:flex-start; justify-content:space-between; gap:14px; margin-bottom:14px; }
      .karsa-crop-head small { display:block; color:#9a7a3b; letter-spacing:.15em; font-size:10px; font-weight:800; margin-bottom:4px; }
      .karsa-crop-head h3 { margin:0; font-size:20px; }
      .karsa-crop-stage { width:min(390px,82vw); aspect-ratio:1; margin:0 auto; overflow:hidden; border-radius:20px; background:#111; position:relative; touch-action:none; cursor:grab; box-shadow:inset 0 0 0 1px rgba(255,255,255,.08); }
      .karsa-crop-stage.dragging { cursor:grabbing; }
      #karsaCropCanvas { width:100%; height:100%; display:block; }
      .karsa-crop-guide { pointer-events:none; position:absolute; inset:0; border-radius:20px; box-shadow:inset 0 0 0 1px rgba(255,255,255,.35); }
      .karsa-crop-guide:before, .karsa-crop-guide:after { content:""; position:absolute; background:rgba(255,255,255,.18); }
      .karsa-crop-guide:before { width:1px; height:100%; left:33.333%; box-shadow:calc(33.333% + 1px) 0 0 rgba(255,255,255,.18); }
      .karsa-crop-guide:after { height:1px; width:100%; top:33.333%; box-shadow:0 calc(33.333% + 1px) 0 rgba(255,255,255,.18); }
      .karsa-crop-tools { display:flex; align-items:center; gap:10px; margin-top:16px; }
      .karsa-crop-tools button { width:42px; height:38px; border:1px solid #ddd; background:#fff; border-radius:11px; cursor:pointer; font-size:18px; font-weight:800; }
      #karsaCropZoom { flex:1; accent-color:#c9a45c; }
      .karsa-crop-help { text-align:center; color:#777; font-size:11px; margin:10px 0 16px; }
      .karsa-crop-footer { display:flex; justify-content:flex-end; gap:10px; }
      .karsa-crop-footer button { border:1px solid #ddd; background:#fff; padding:11px 15px; border-radius:12px; cursor:pointer; font-weight:700; }
      .karsa-crop-footer .primary { background:#c9a45c; border-color:#c9a45c; color:#fff; }
      @media(max-width:520px){ .karsa-crop-card{padding:16px;border-radius:20px}.karsa-crop-stage{width:min(88vw,390px)} }

      .karsa-profile-btn.identity{background:#111;color:#d3b06a;border:1px solid #3f3625}
      .karsa-identity-modal{position:fixed;inset:0;z-index:10001;display:flex;align-items:center;justify-content:center;padding:18px;background:rgba(4,4,4,.78);backdrop-filter:blur(16px)}
      .karsa-identity-modal.hidden{display:none}
      .karsa-identity-shell{width:min(760px,100%);max-height:94vh;overflow:auto;background:#f7f5f0;color:#111;border:1px solid rgba(201,164,92,.35);border-radius:28px;padding:26px;box-shadow:0 40px 100px rgba(0,0,0,.45)}
      .karsa-identity-head{display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:20px}.karsa-identity-head small{display:block;color:#9a7a3b;font-size:10px;letter-spacing:.18em;font-weight:800}.karsa-identity-head h3{margin:5px 0 0;font-size:25px}
      .karsa-id-scene{display:flex;justify-content:center;perspective:1200px;padding:10px 0 20px}.karsa-id-card{width:min(620px,92vw);aspect-ratio:1.586;position:relative;transform-style:preserve-3d;transition:transform .65s cubic-bezier(.2,.7,.2,1)}.karsa-id-card.flipped{transform:rotateY(180deg)}
      .karsa-id-face{position:absolute;inset:0;backface-visibility:hidden;border-radius:24px;overflow:hidden;color:#fff;background:radial-gradient(circle at 85% 15%,rgba(201,164,92,.18),transparent 30%),linear-gradient(135deg,#080808,#15130f 55%,#080808);box-shadow:0 24px 55px rgba(0,0,0,.28);border:1px solid rgba(201,164,92,.5)}.karsa-id-face:before{content:"";position:absolute;inset:0;background:linear-gradient(120deg,transparent 35%,rgba(255,255,255,.045) 50%,transparent 65%);pointer-events:none}.karsa-id-back{transform:rotateY(180deg);display:flex;flex-direction:column;align-items:center;justify-content:center;background:radial-gradient(circle at 50% 25%,rgba(201,164,92,.16),transparent 34%),linear-gradient(145deg,#080808,#191612)}
      .karsa-id-noise{position:absolute;inset:0;opacity:.08;background-image:radial-gradient(#fff .5px,transparent .5px);background-size:5px 5px}.karsa-id-top{position:relative;display:flex;justify-content:space-between;align-items:center;padding:28px 32px 0}.karsa-id-brand,.karsa-id-back-brand{font-size:28px;font-weight:900;letter-spacing:.16em;color:#d3b06a}.karsa-id-top span{font-size:9px;letter-spacing:.2em;color:#bba77b}.karsa-id-main{position:relative;display:flex;align-items:center;gap:24px;padding:30px 32px}.karsa-id-photo{width:128px;height:128px;flex:0 0 128px;border-radius:18px;background:#222 center/cover no-repeat;display:flex;align-items:center;justify-content:center;font-size:40px;font-weight:800;color:#d3b06a;border:1px solid rgba(201,164,92,.65);box-shadow:0 12px 30px rgba(0,0,0,.3)}.karsa-id-info{min-width:0}.karsa-id-name{font-size:clamp(20px,4vw,32px);font-weight:800;letter-spacing:.01em;line-height:1.1}.karsa-id-title{margin-top:7px;color:#d2bd91;font-size:13px}.karsa-id-line{width:150px;border-top:1px solid #806633;margin:13px 0}.karsa-id-meta{font-size:12px;color:#f0ede6}.karsa-id-id{font-size:10px;color:#a99d86;margin-top:6px;letter-spacing:.1em}.karsa-id-bottom{position:absolute;left:32px;right:32px;bottom:24px;display:flex;justify-content:space-between;align-items:center;font-size:8px;letter-spacing:.12em;color:#a79a80}.karsa-id-bottom b{color:#d3b06a}.karsa-id-back-brand{font-size:34px}.karsa-id-back-title{margin:8px 0 14px;color:#c9ad72;font-size:10px;letter-spacing:.22em}.karsa-id-qr{background:#fff;padding:8px;border-radius:12px;min-width:148px;min-height:148px;display:flex;align-items:center;justify-content:center}.karsa-id-qr img{display:block}.karsa-id-verify{margin-top:10px;font-size:10px;letter-spacing:.16em;color:#c9ad72}.karsa-id-back-footer{position:absolute;bottom:20px;left:30px;right:30px;text-align:center;color:#77736b;font-size:8px}.karsa-id-controls{display:flex;justify-content:center;gap:10px;flex-wrap:wrap}.karsa-id-controls button{border:1px solid #d8cfbf;background:#fff;border-radius:12px;padding:11px 16px;font-weight:700;cursor:pointer}.karsa-id-note{text-align:center;color:#8b867d;font-size:11px;margin-top:14px;line-height:1.5}
      @media(max-width:600px){.karsa-identity-shell{padding:18px;border-radius:22px}.karsa-id-top{padding:18px 20px 0}.karsa-id-brand{font-size:20px}.karsa-id-top span{font-size:7px}.karsa-id-main{gap:14px;padding:20px}.karsa-id-photo{width:84px;height:84px;flex-basis:84px;border-radius:13px;font-size:28px}.karsa-id-name{font-size:18px}.karsa-id-title{font-size:10px}.karsa-id-line{margin:8px 0;width:90px}.karsa-id-meta{font-size:9px}.karsa-id-id{font-size:8px}.karsa-id-bottom{left:20px;right:20px;bottom:15px;font-size:6px}.karsa-id-qr{min-width:100px;min-height:100px;padding:6px}.karsa-id-qr img{width:88px!important;height:88px!important}.karsa-id-back-brand{font-size:25px}.karsa-id-back-title{font-size:7px}.karsa-id-verify{font-size:7px}.karsa-id-back-footer{font-size:6px;bottom:13px}}
    `;
    document.head.appendChild(style);

    if (!document.getElementById("karsaIdentityV7Style")) {
      const identityFix = document.createElement("style");
      identityFix.id = "karsaIdentityV7Style";
      identityFix.textContent = `
        .karsa-id-scene{perspective:1400px;overflow:visible;isolation:isolate;}
        .karsa-id-card{transform-style:preserve-3d;-webkit-transform-style:preserve-3d;}
        .karsa-id-face{backface-visibility:hidden;-webkit-backface-visibility:hidden;transform-style:preserve-3d;-webkit-transform-style:preserve-3d;}
        .karsa-id-front{transform:rotateY(0deg);}
        .karsa-id-back{transform:rotateY(180deg);}
        .karsa-id-main{padding-right:24px;}
        .karsa-id-label{font-size:8px;letter-spacing:.14em;color:#bba77b;margin-bottom:7px;font-weight:800;}
        .karsa-id-qr-front{width:100px;height:100px;flex:0 0 100px;background:#fff;padding:8px;border-radius:12px;display:flex;align-items:center;justify-content:center;box-shadow:0 8px 20px rgba(0,0,0,.24);}
        .karsa-id-qr-front img{width:84px!important;height:84px!important;display:block!important;}
        .karsa-qr-fallback{font-size:12px;font-weight:900;color:#111;}
        .karsa-id-back-brand-wrap{display:flex;align-items:center;gap:10px;}
        .karsa-id-back-logo{width:30px;height:30px;}
        .karsa-id-company-grid{width:min(520px,86%);display:grid;grid-template-columns:1fr 1fr;gap:10px;}
        .karsa-id-company-grid>div{padding:11px 12px;border:1px solid rgba(201,164,92,.22);border-radius:11px;background:rgba(255,255,255,.025);min-width:0;}
        .karsa-id-company-grid span{display:block;font-size:7px;letter-spacing:.14em;color:#8f8169;margin-bottom:5px;font-weight:800;}
        .karsa-id-company-grid b{display:block;font-size:10px;color:#e9e4db;line-height:1.25;font-weight:700;}
        .karsa-id-back-title{margin:7px 0 14px;}
        .karsa-id-back-footer{font-size:8px;}
        .karsa-id-controls button{white-space:nowrap;}
        @media(max-width:600px){
          .karsa-id-card{width:min(560px,calc(100vw - 36px));}
          .karsa-id-main{gap:10px;padding:18px 18px;}
          .karsa-id-photo{width:82px;height:92px;flex-basis:82px;}
          .karsa-id-name{font-size:17px;}
          .karsa-id-qr-front{width:72px;height:72px;flex-basis:72px;padding:6px;border-radius:9px;}
          .karsa-id-qr-front img{width:60px!important;height:60px!important;}
          .karsa-id-company-grid{width:88%;gap:7px;}
          .karsa-id-company-grid>div{padding:8px;}
          .karsa-id-company-grid b{font-size:8px;}
        }
      `;
      document.head.appendChild(identityFix);
    }

    const modal = document.createElement("div");
    modal.id = "karsaProfileModal";
    modal.className = "karsa-profile-modal hidden";
    modal.innerHTML = `
      <div class="karsa-profile-card" role="dialog" aria-modal="true" aria-label="Profil pengguna">
        <div class="karsa-profile-head">
          <div><small>KARSA ACCOUNT</small><h2>Profil Saya</h2></div>
          <button class="karsa-profile-close" type="button" data-profile-close>×</button>
        </div>
        <div class="karsa-profile-avatar-wrap">
          <div id="profileAvatarPreview" class="karsa-profile-avatar">K</div>
        </div>
        <div class="karsa-profile-actions">
          <label class="karsa-profile-btn gold" style="cursor:pointer">
            Pilih Foto
            <input id="profileAvatarInput" type="file" accept="image/*" hidden>
          </label>
          <button id="removeAvatarBtn" class="karsa-profile-btn danger" type="button">Hapus Foto</button>
        </div>
        <div class="karsa-profile-field">
          <label for="profileNameInput">NAMA</label>
          <input id="profileNameInput" type="text" autocomplete="name">
        </div>
        <div class="karsa-profile-meta">
          <div><span>Email</span><strong id="profileEmailText">—</strong></div>
          <div><span>Jabatan</span><strong id="profileTitleText">—</strong></div>
          <div><span>Divisi</span><strong id="profileDivisionText">—</strong></div>
        </div>
        <div class="karsa-profile-note">Foto profil maksimal 5 MB. Format gambar umum didukung.</div>
        <div class="karsa-profile-footer">
          <button id="openIdentityCardBtn" class="karsa-profile-btn identity" type="button">Kartu Identitas</button>
          <button class="karsa-profile-btn" type="button" data-profile-close>Tutup</button>
          <button id="saveProfileBtn" class="karsa-profile-btn gold" type="button">Simpan Perubahan</button>
        </div>
        <button id="profileLogoutBtn" class="karsa-profile-logout" type="button">Keluar dari akun</button>
      </div>`;
    document.body.appendChild(modal);

    modal.addEventListener("click", e => {
      if (e.target === modal || e.target.closest("[data-profile-close]")) closeProfile();
    });

    const identityModal = document.createElement("div");
    identityModal.id = "karsaIdentityModal";
    identityModal.className = "karsa-identity-modal hidden";
    identityModal.innerHTML = `
      <div class="karsa-identity-shell" role="dialog" aria-modal="true" aria-label="Kartu Identitas KARSA">
        <div class="karsa-identity-head">
          <div><small>KARSA EXECUTIVE IDENTITY</small><h3>Kartu Identitas</h3></div>
          <button class="karsa-profile-close" type="button" data-identity-close>×</button>
        </div>
        <div class="karsa-id-scene">
          <div id="karsaIdentityCard" class="karsa-id-card">
            <div class="karsa-id-face karsa-id-front">
              <div class="karsa-id-noise"></div>
              <div class="karsa-id-top">
                <div class="karsa-id-brand-wrap"><img class="karsa-id-logo" src="assets/karsa-mark.jpg" alt="KARSA"><div class="karsa-id-brand">KARSA</div></div>
                <span>EXECUTIVE ID</span>
              </div>
              <div class="karsa-id-main">
                <div id="identityPhoto" class="karsa-id-photo">K</div>
                <div class="karsa-id-info">
                  <div class="karsa-id-label">AUTHORIZED MEMBER</div>
                  <div id="identityName" class="karsa-id-name">—</div>
                  <div id="identityTitle" class="karsa-id-title">—</div>
                  <div class="karsa-id-line"></div>
                  <div id="identityDivision" class="karsa-id-meta">—</div>
                  <div id="identityEmployeeId" class="karsa-id-id">ID —</div>
                </div>
                <div id="identityQr" class="karsa-id-qr-front" aria-label="QR verifikasi identitas"></div>
              </div>
              <div class="karsa-id-bottom"><span>PT KARSA LIFESTYLE NUSANTARA</span><b>ACTIVE</b></div>
            </div>
            <div class="karsa-id-face karsa-id-back">
              <div class="karsa-id-back-brand-wrap"><img class="karsa-id-logo back-logo" src="assets/karsa-mark.jpg" alt="KARSA"><div class="karsa-id-back-brand">KARSA</div></div>
              <div class="karsa-id-back-title">PT KARSA LIFESTYLE NUSANTARA</div>
              <div class="karsa-id-company-grid">
                <div><span>COMPANY</span><b>PT Karsa Lifestyle Nusantara</b></div>
                <div><span>IDENTITY</span><b>Official Internal Employee Card</b></div>
                <div><span>VERIFICATION</span><b>Scan QR on front</b></div>
                <div><span>STATUS</span><b>ACTIVE / AUTHORIZED</b></div>
              </div>
              <div id="identityVerifyText" class="karsa-id-verify">KARSA IDENTITY</div>
              <div class="karsa-id-back-footer">This card identifies an authorized member of PT Karsa Lifestyle Nusantara.</div>
            </div>
          </div>
        </div>
        <div class="karsa-id-controls">
          <button id="flipIdentityBtn" type="button">↻ Balik Kartu</button>
          <button id="downloadIdentityFrontBtn" type="button">↓ Download Depan</button>
          <button id="downloadIdentityBackBtn" type="button">↓ Download Belakang</button>
          <button id="printIdentityBtn" type="button">Cetak</button>
        </div>
        <div class="karsa-id-note">Kartu mengikuti data profil yang tersimpan pada akun. QR digunakan untuk verifikasi identitas internal.</div>
      </div>`;
    document.body.appendChild(identityModal);
    identityModal.addEventListener("click", e => {
      if (e.target === identityModal || e.target.closest("[data-identity-close]")) closeIdentityCard();
    });
    $("flipIdentityBtn").addEventListener("click", () => $("karsaIdentityCard").classList.toggle("flipped"));
    $("printIdentityBtn").addEventListener("click", printIdentityCard);
    $("downloadIdentityFrontBtn").addEventListener("click", () => downloadIdentityCard("front"));
    $("downloadIdentityBackBtn").addEventListener("click", () => downloadIdentityCard("back"));

    const cropModal = document.createElement("div");
    cropModal.id = "karsaCropModal";
    cropModal.className = "karsa-crop-modal hidden";
    cropModal.innerHTML = `
      <div class="karsa-crop-card" role="dialog" aria-modal="true" aria-label="Sesuaikan foto profil">
        <div class="karsa-crop-head">
          <div><small>KARSA PROFILE</small><h3>Sesuaikan Foto</h3></div>
          <button class="karsa-profile-close" type="button" data-crop-close>×</button>
        </div>
        <div id="karsaCropStage" class="karsa-crop-stage">
          <canvas id="karsaCropCanvas" width="512" height="512"></canvas>
          <div class="karsa-crop-guide"></div>
        </div>
        <div class="karsa-crop-tools">
          <button type="button" id="cropZoomOut" aria-label="Perkecil">−</button>
          <input id="karsaCropZoom" type="range" min="1" max="3.5" step="0.01" value="1">
          <button type="button" id="cropZoomIn" aria-label="Perbesar">+</button>
        </div>
        <div class="karsa-crop-help">Geser foto untuk mengatur posisi. Gunakan slider atau tombol +/− untuk memperbesar.</div>
        <div class="karsa-crop-footer">
          <button type="button" data-crop-close>Batal</button>
          <button type="button" id="useCroppedAvatar" class="primary">Gunakan Foto</button>
        </div>
      </div>`;
    document.body.appendChild(cropModal);

    cropModal.addEventListener("click", e => {
      if (e.target === cropModal || e.target.closest("[data-crop-close]")) closeCropper();
    });
    $("cropZoomOut").addEventListener("click", () => adjustCropZoom(-0.15));
    $("cropZoomIn").addEventListener("click", () => adjustCropZoom(0.15));
    $("karsaCropZoom").addEventListener("input", e => {
      if (!window.__karsaCrop) return;
      window.__karsaCrop.scale = Number(e.target.value);
      drawCropper();
    });
    $("useCroppedAvatar").addEventListener("click", useCroppedAvatar);

    const cropStage = $("karsaCropStage");
    cropStage.addEventListener("pointerdown", e => {
      const c = window.__karsaCrop;
      if (!c) return;
      cropStage.setPointerCapture(e.pointerId);
      c.dragging = true;
      c.pointerId = e.pointerId;
      c.lastX = e.clientX;
      c.lastY = e.clientY;
      cropStage.classList.add("dragging");
    });
    cropStage.addEventListener("pointermove", e => {
      const c = window.__karsaCrop;
      if (!c || !c.dragging || c.pointerId !== e.pointerId) return;
      c.x += e.clientX - c.lastX;
      c.y += e.clientY - c.lastY;
      c.lastX = e.clientX;
      c.lastY = e.clientY;
      drawCropper();
    });
    const endCropDrag = e => {
      const c = window.__karsaCrop;
      if (!c || c.pointerId !== e.pointerId) return;
      c.dragging = false;
      cropStage.classList.remove("dragging");
    };
    cropStage.addEventListener("pointerup", endCropDrag);
    cropStage.addEventListener("pointercancel", endCropDrag);
    cropStage.addEventListener("wheel", e => {
      e.preventDefault();
      adjustCropZoom(e.deltaY > 0 ? -0.08 : 0.08);
    }, {passive:false});

    // Fullscreen photo viewer for the user's profile photo.
    const photoViewer = document.createElement("div");
    photoViewer.id = "karsaPhotoViewer";
    photoViewer.className = "karsa-photo-viewer hidden";
    photoViewer.innerHTML = `<div class="karsa-photo-viewer-card"><button type="button" class="karsa-photo-viewer-close" data-photo-viewer-close>×</button><img id="karsaPhotoViewerImg" alt="Foto profil"><div id="karsaPhotoViewerName" class="karsa-photo-viewer-name"></div></div>`;
    document.body.appendChild(photoViewer);
    photoViewer.addEventListener("click", e => { if (e.target === photoViewer || e.target.closest("[data-photo-viewer-close]")) photoViewer.classList.add("hidden"); });
    $("profileAvatarPreview").addEventListener("click", () => {
      if (!state.user?.avatarUrl) return;
      const img = $("karsaPhotoViewerImg");
      img.src = state.user.avatarUrl;
      $("karsaPhotoViewerName").textContent = state.user.name || "Foto Profil";
      photoViewer.classList.remove("hidden");
    });

    $("profileAvatarInput").addEventListener("change", async e => {
      const file = e.target.files?.[0];
      if (file) openCropper(file);
      e.target.value = "";
    });

    $("removeAvatarBtn").addEventListener("click", removeAvatar);
    $("saveProfileBtn").addEventListener("click", saveProfile);
    $("profileLogoutBtn").addEventListener("click", async () => {
      closeProfile();
      await logout();
    });
    $("openIdentityCardBtn").addEventListener("click", openIdentityCard);
  }

  function normalizeKarsaDivision(value) {
    const raw = String(value || "").trim();
    return ({
      ITIT: "IT",
      FinanceFinance: "Finance",
      OperasionalOperasional: "Operasional",
      "R&DR&D": "R&D"
    })[raw] || raw || "—";
  }

  function normalizeKarsaEmployeeId(value, division) {
    const raw = String(value || "").trim();
    if (!raw) return "";
    const normalized = raw
      .replace(/^KRSA-ITIT-/i, "KRSA-IT-")
      .replace(/^KRSA-FINANCEFINANCE-/i, "KRSA-FIN-")
      .replace(/^KRSA-OPERASIONALOPERASIONAL-/i, "KRSA-OPS-")
      .replace(/^KRSA-R&DR&D-/i, "KRSA-RND-");
    return normalized;
  }

  function getIdentityId() {
    const u = state.user || {};
    const stored = normalizeKarsaEmployeeId(u.employeeId, u.division);
    if (stored) return stored;
    const division = normalizeKarsaDivision(u.division);
    const code = ({Finance:"FIN", IT:"IT", Operasional:"OPS", "R&D":"RND"})[division] || "KRS";
    const raw = String(u.id || "").replace(/-/g, "").slice(0, 6).toUpperCase() || "000000";
    return `KRSA-${code}-${raw}`;
  }

  function loadQrLibrary() {
    return new Promise((resolve, reject) => {
      if (window.qrcode) return resolve(window.qrcode);
      const existing = document.querySelector('script[data-karsa-qr]');
      if (existing) {
        existing.addEventListener("load", () => resolve(window.qrcode));
        existing.addEventListener("error", reject);
        return;
      }
      const script = document.createElement("script");
      script.src = "https://cdn.jsdelivr.net/npm/qrcode-generator@1.4.4/qrcode.js";
      script.async = true;
      script.dataset.karsaQr = "1";
      script.onload = () => window.qrcode ? resolve(window.qrcode) : reject(new Error("QR library unavailable"));
      script.onerror = reject;
      document.head.appendChild(script);
    });
  }

  async function renderIdentityQr() {
    const box = $("identityQr");
    if (!box || !state.user) return;
    box.innerHTML = "";
    try {
      const qr = await loadQrLibrary();
      const verifyUrl = `${location.origin}${location.pathname}?verify=${encodeURIComponent(getIdentityId())}`;
      const q = qr(0, "M");
      q.addData(verifyUrl);
      q.make();
      box.innerHTML = q.createImgTag(3, 0);
      const img = box.querySelector("img");
      if (img) {
        img.alt = "QR verifikasi identitas";
        img.width = 84;
        img.height = 84;
        img.style.width = "84px";
        img.style.height = "84px";
        img.style.display = "block";
      }
    } catch (err) {
      box.innerHTML = `<span class="karsa-qr-fallback">QR</span>`;
    }
  }

  function openIdentityCard() {
    if (!state.user) return;
    const u = state.user;
    $("identityName").textContent = u.name || "—";
    $("identityTitle").textContent = u.title || roleLabel(u.role) || "—";
    $("identityDivision").textContent = normalizeKarsaDivision(u.division);
    $("identityEmployeeId").textContent = `ID ${getIdentityId()}`;
    $("identityVerifyText").textContent = getIdentityId();
    const photo = $("identityPhoto");
    photo.textContent = u.avatarUrl ? "" : (u.initials || initials(u.name));
    photo.style.backgroundImage = u.avatarUrl ? `url("${u.avatarUrl}")` : "";
    $("karsaIdentityCard").classList.remove("flipped");
    $("karsaIdentityModal").classList.remove("hidden");
    renderIdentityQr();
  }

  function closeIdentityCard() {
    $("karsaIdentityModal")?.classList.add("hidden");
  }

  function printIdentityCard() {
    if (!state.user) return;
    const card = $("karsaIdentityCard");
    if (!card) return;
    const front = card.querySelector(".karsa-id-front")?.outerHTML || "";
    const back = card.querySelector(".karsa-id-back")?.outerHTML || "";
    const printWin = window.open("", "_blank", "width=900,height=700");
    if (!printWin) { showToast("Izinkan pop-up untuk mencetak kartu."); return; }

    const html = `<!doctype html><html><head><title>Kartu Identitas KARSA</title><style>
      @page{size:auto;margin:10mm}
      *{box-sizing:border-box}
      body{margin:0;background:#fff;font-family:Arial,sans-serif;padding:18px;display:flex;justify-content:center}
      .wrap{display:flex;gap:18px;align-items:flex-start;flex-wrap:wrap}
      .card{width:360px;height:227px;position:relative;overflow:hidden;border-radius:18px;color:#fff;background:linear-gradient(135deg,#080808,#17130d 55%,#080808);border:1px solid #8b6f35}
      .karsa-id-face{position:relative!important;inset:auto!important;width:100%;height:100%;border:0!important;border-radius:0!important;box-shadow:none!important;overflow:hidden!important;background:linear-gradient(135deg,#080808,#17130d 55%,#080808)!important;color:#fff}
      .karsa-id-noise{position:absolute;inset:0;opacity:.07;background-image:radial-gradient(#fff .5px,transparent .5px);background-size:5px 5px}
      .karsa-id-top{position:relative;display:flex;justify-content:space-between;align-items:center;padding:20px 22px 0}
      .karsa-id-brand-wrap,.karsa-id-back-brand-wrap{display:flex;align-items:center;gap:8px}.karsa-id-logo{width:25px;height:25px;border-radius:6px;object-fit:cover;border:1px solid #765b2d}.karsa-id-brand,.karsa-id-back-brand{font-size:23px;font-weight:900;letter-spacing:.12em;color:#d3b06a}.karsa-id-top span{font-size:7px;letter-spacing:.18em;color:#bba77b}
      .karsa-id-main{position:relative;display:flex;align-items:center;gap:14px;padding:20px 22px}.karsa-id-photo{width:76px;height:88px;flex:0 0 76px;border-radius:12px;background:#222 center/cover no-repeat;display:flex;align-items:center;justify-content:center;font-size:25px;font-weight:800;color:#d3b06a;border:1px solid #806633}.karsa-id-info{min-width:0;flex:1}.karsa-id-label{font-size:6px;letter-spacing:.15em;color:#bba77b;margin-bottom:4px}.karsa-id-name{font-size:17px;font-weight:800;line-height:1.08}.karsa-id-title{margin-top:4px;color:#d2bd91;font-size:9px}.karsa-id-line{width:90px;border-top:1px solid #806633;margin:7px 0}.karsa-id-meta{font-size:8px}.karsa-id-id{font-size:7px;color:#a99d86;margin-top:4px;letter-spacing:.08em}.karsa-id-qr-front{background:#fff;padding:5px;border-radius:7px;width:64px;height:64px;display:flex;align-items:center;justify-content:center;flex:0 0 64px}.karsa-id-qr-front img{width:54px!important;height:54px!important;display:block}.karsa-id-bottom{position:absolute;left:22px;right:22px;bottom:13px;display:flex;justify-content:space-between;font-size:6px;letter-spacing:.1em;color:#a79a80}.karsa-id-bottom b{color:#d3b06a}
      .karsa-id-back{display:flex!important;flex-direction:column!important;align-items:center!important;justify-content:center!important}.karsa-id-back-title{margin:5px 0 11px;color:#c9ad72;font-size:7px;letter-spacing:.16em}.karsa-id-company-grid{width:78%;display:grid;grid-template-columns:1fr 1fr;gap:7px}.karsa-id-company-grid>div{padding:7px 8px;border:1px solid rgba(201,164,92,.22);border-radius:7px;background:rgba(255,255,255,.025)}.karsa-id-company-grid span{display:block;font-size:5px;letter-spacing:.13em;color:#8f8169;margin-bottom:3px}.karsa-id-company-grid b{display:block;font-size:7px;color:#e9e4db;line-height:1.2}.karsa-id-verify{margin-top:8px;font-size:6px;letter-spacing:.14em;color:#c9ad72}.karsa-id-back-footer{position:absolute;bottom:12px;left:22px;right:22px;text-align:center;color:#77736b;font-size:6px}
      </style></head><body><div class="wrap"><div class="card">${front}</div><div class="card">${back}</div></div><script>window.onload=function(){setTimeout(function(){window.print();},250)};<\/script></body></html>`;
    printWin.document.open();
    printWin.document.write(html);
    printWin.document.close();
  }

  function canvasRoundRect(ctx, x, y, w, h, r) {
    const radius = Math.min(r, w / 2, h / 2);
    ctx.beginPath();
    ctx.moveTo(x + radius, y);
    ctx.arcTo(x + w, y, x + w, y + h, radius);
    ctx.arcTo(x + w, y + h, x, y + h, radius);
    ctx.arcTo(x, y + h, x, y, radius);
    ctx.arcTo(x, y, x + w, y, radius);
    ctx.closePath();
  }

  function drawCanvasCover(ctx, img, x, y, w, h) {
    const iw = img.naturalWidth || img.width;
    const ih = img.naturalHeight || img.height;
    if (!iw || !ih) return;
    const scale = Math.max(w / iw, h / ih);
    const dw = iw * scale, dh = ih * scale;
    const dx = x + (w - dw) / 2, dy = y + (h - dh) / 2;
    ctx.drawImage(img, dx, dy, dw, dh);
  }

  function drawCanvasFit(ctx, img, x, y, w, h) {
    const iw = img.naturalWidth || img.width;
    const ih = img.naturalHeight || img.height;
    if (!iw || !ih) return;
    const scale = Math.min(w / iw, h / ih);
    const dw = iw * scale, dh = ih * scale;
    ctx.drawImage(img, x + (w - dw) / 2, y + (h - dh) / 2, dw, dh);
  }

  function drawCardBackground(ctx, W, H, back = false) {
    const bg = ctx.createLinearGradient(0, 0, W, H);
    bg.addColorStop(0, "#050505");
    bg.addColorStop(.34, back ? "#14100b" : "#17130d");
    bg.addColorStop(.7, "#090909");
    bg.addColorStop(1, "#020202");
    ctx.fillStyle = bg; ctx.fillRect(0, 0, W, H);

    const glow = ctx.createRadialGradient(W * .82, H * .08, 0, W * .82, H * .08, W * .52);
    glow.addColorStop(0, "rgba(211,176,106,.18)");
    glow.addColorStop(.45, "rgba(201,164,92,.045)");
    glow.addColorStop(1, "rgba(201,164,92,0)");
    ctx.fillStyle = glow; ctx.fillRect(0, 0, W, H);

    ctx.strokeStyle = "rgba(211,176,106,.78)"; ctx.lineWidth = 3;
    canvasRoundRect(ctx, 9, 9, W - 18, H - 18, 34); ctx.stroke();
    ctx.strokeStyle = "rgba(255,255,255,.09)"; ctx.lineWidth = 1;
    canvasRoundRect(ctx, 20, 20, W - 40, H - 40, 27); ctx.stroke();

    ctx.save(); ctx.globalAlpha = .07; ctx.strokeStyle = "#d3b06a"; ctx.lineWidth = 2;
    for (let i = -H; i < W + H; i += 42) {
      ctx.beginPath(); ctx.moveTo(i, 0); ctx.lineTo(i - H * .55, H); ctx.stroke();
    }
    ctx.restore();
  }

  async function downloadIdentityCard(side) {
    if (!state.user) return;
    // High-resolution PNG: 1600px wide, same 1.586 card ratio.
    const W = 1600, H = 1009;
    const canvas = document.createElement("canvas");
    canvas.width = W; canvas.height = H;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    drawCardBackground(ctx, W, H, side === "back");
    if (side === "back") await drawIdentityBackCanvas(ctx, W, H);
    else await drawIdentityFrontCanvas(ctx, W, H);

    canvas.toBlob(blob => {
      if (!blob) { showToast("Kartu gagal dibuat."); return; }
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `KARSA-ID-${getIdentityId()}-${side === "back" ? "BACK" : "FRONT"}.png`;
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1500);
      showToast(`Kartu ${side === "back" ? "belakang" : "depan"} berhasil diunduh.`);
    }, "image/png");
  }

  async function drawIdentityFrontCanvas(ctx, W, H) {
    const logo = await loadIdentityCanvasImage("assets/karsa-mark.jpg");
    const avatar = await loadIdentityCanvasImage(state.user.avatarUrl || "");
    const pad = 70;

    // Subtle luxury watermark to use the canvas space without making the card feel empty.
    ctx.save();
    ctx.globalAlpha = .035;
    ctx.fillStyle = "#d8b76f";
    ctx.font = "900 260px Arial";
    ctx.textAlign = "center";
    ctx.fillText("KARSA", W * .66, H * .78);
    ctx.restore();

    // Premium header
    if (logo) {
      ctx.save();
      canvasRoundRect(ctx, pad, 58, 100, 100, 25);
      ctx.clip();
      drawCanvasCover(ctx, logo, pad, 58, 100, 100);
      ctx.restore();
      ctx.strokeStyle = "rgba(211,176,106,.85)";
      ctx.lineWidth = 3;
      canvasRoundRect(ctx, pad, 58, 100, 100, 25);
      ctx.stroke();
    }
    ctx.fillStyle = "#dfbd70";
    ctx.font = "900 72px Arial";
    ctx.fillText("KARSA", 195, 132);
    ctx.fillStyle = "#b49a69";
    ctx.font = "800 23px Arial";
    ctx.textAlign = "right";
    ctx.fillText("IDENTITY • 01", W - pad, 102);
    ctx.fillStyle = "#857455";
    ctx.font = "700 18px Arial";
    ctx.fillText("PT KARSA LIFESTYLE NUSANTARA", W - pad, 130);
    ctx.textAlign = "left";

    // Main identity area: larger photo + stronger typography.
    const px = pad, py = 205, pw = 340, ph = 430;
    ctx.save();
    canvasRoundRect(ctx, px, py, pw, ph, 34);
    ctx.clip();
    if (avatar) drawCanvasCover(ctx, avatar, px, py, pw, ph);
    else {
      ctx.fillStyle = "#171717";
      ctx.fillRect(px, py, pw, ph);
      ctx.fillStyle = "#d3b06a";
      ctx.font = "900 92px Arial";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(initials(state.user.name), px + pw/2, py + ph/2);
      ctx.textAlign = "left";
      ctx.textBaseline = "alphabetic";
    }
    ctx.restore();
    ctx.strokeStyle = "rgba(211,176,106,.88)";
    ctx.lineWidth = 4;
    canvasRoundRect(ctx, px, py, pw, ph, 34);
    ctx.stroke();

    const infoX = 465;
    ctx.fillStyle = "#b69b69";
    ctx.font = "800 21px Arial";
    ctx.fillText("AUTHORIZED MEMBER", infoX, 226);

    ctx.fillStyle = "#faf7f0";
    ctx.font = "900 58px Arial";
    drawCanvasWrapped(ctx, state.user.name || "—", infoX, 304, 710, 62);

    ctx.fillStyle = "#dfc58f";
    ctx.font = "700 31px Arial";
    drawCanvasWrapped(ctx, state.user.title || roleLabel(state.user.role) || "—", infoX, 382, 650, 36);

    ctx.strokeStyle = "rgba(211,176,106,.65)";
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(infoX, 424);
    ctx.lineTo(infoX + 255, 424);
    ctx.stroke();

    ctx.fillStyle = "#f4efe6";
    ctx.font = "800 31px Arial";
    ctx.fillText(`DIVISION  ${normalizeKarsaDivision(state.user.division).toUpperCase()}`, infoX, 476);

    ctx.fillStyle = "#b7a98d";
    ctx.font = "700 26px monospace";
    ctx.fillText(`ID  ${getIdentityId()}`, infoX, 518);

    // Compact status badge under identity information.
    ctx.fillStyle = "rgba(211,176,106,.10)";
    ctx.strokeStyle = "rgba(211,176,106,.38)";
    ctx.lineWidth = 2;
    canvasRoundRect(ctx, infoX, 548, 190, 54, 16);
    ctx.fill(); ctx.stroke();
    ctx.fillStyle = "#dfbd70";
    ctx.font = "900 20px Arial";
    ctx.fillText("●  ACTIVE", infoX + 24, 583);

    // Larger QR, balanced against the photo instead of leaving a large dead zone.
    const qrSize = 255, qrX = W - pad - qrSize, qrY = 205;
    ctx.fillStyle = "#fff";
    canvasRoundRect(ctx, qrX, qrY, qrSize, qrSize, 25);
    ctx.fill();
    const qrImg = document.querySelector("#identityQr img");
    if (qrImg && qrImg.complete) {
      ctx.imageSmoothingEnabled = false;
      drawCanvasFit(ctx, qrImg, qrX + 20, qrY + 20, qrSize - 40, qrSize - 40);
      ctx.imageSmoothingEnabled = true;
    }
    ctx.fillStyle = "#b69b69";
    ctx.font = "900 19px Arial";
    ctx.fillText("SCAN TO VERIFY", qrX, qrY + qrSize + 31);

    // Lower information strip fills the card naturally without crowding the identity block.
    const stripY = 742;
    ctx.strokeStyle = "rgba(211,176,106,.42)";
    ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(pad, stripY); ctx.lineTo(W - pad, stripY); ctx.stroke();

    ctx.fillStyle = "#877654";
    ctx.font = "800 18px Arial";
    ctx.fillText("OFFICIAL EMPLOYEE IDENTITY", pad, stripY + 43);
    ctx.fillStyle = "#d3b06a";
    ctx.font = "900 20px Arial";
    ctx.fillText(`KARSA ID  •  ${getIdentityId()}`, pad, stripY + 75);

    ctx.fillStyle = "#877654";
    ctx.font = "800 18px Arial";
    ctx.textAlign = "right";
    ctx.fillText("AUTHORIZED • INTERNAL USE", W - pad, stripY + 43);
    ctx.fillStyle = "#dfbd70";
    ctx.font = "900 20px Arial";
    ctx.fillText("PT KARSA LIFESTYLE NUSANTARA", W - pad, stripY + 75);
    ctx.textAlign = "left";
  }

  async function drawIdentityBackCanvas(ctx, W, H) {
    const logo = await loadIdentityCanvasImage("assets/karsa-mark.jpg");
    const pad = 74;
    if (logo) {
      ctx.save(); canvasRoundRect(ctx, pad, 72, 70, 70, 18); ctx.clip(); drawCanvasCover(ctx, logo, pad, 72, 70, 70); ctx.restore();
      ctx.strokeStyle = "rgba(211,176,106,.72)"; ctx.lineWidth = 2; canvasRoundRect(ctx, pad, 72, 70, 70, 18); ctx.stroke();
    }
    ctx.fillStyle = "#d8b76f"; ctx.font = "900 58px Arial"; ctx.fillText("KARSA", 164, 120);
    ctx.fillStyle = "#9d8961"; ctx.font = "700 23px Arial"; ctx.fillText("OFFICIAL EMPLOYEE IDENTITY", 164, 148);

    ctx.fillStyle = "#f1ede5"; ctx.font = "800 31px Arial"; ctx.fillText("PT Karsa Lifestyle Nusantara", pad, 238);
    ctx.fillStyle = "#9f927d"; ctx.font = "600 20px Arial"; ctx.fillText("KARSA INTERNAL IDENTITY SYSTEM", pad, 269);

    const items = [
      ["IDENTITY", "Official Employee Card"],
      ["VERIFICATION", "Scan the QR on the front"],
      ["STATUS", "ACTIVE / AUTHORIZED"],
      ["EMPLOYEE ID", getIdentityId()]
    ];
    const boxW = 700, boxH = 106, gap = 22;
    const x1 = pad, x2 = W - pad - boxW, y1 = 322, y2 = y1 + boxH + gap;
    items.forEach((it, i) => {
      const x = i % 2 ? x2 : x1, y = i < 2 ? y1 : y2;
      ctx.fillStyle = "rgba(255,255,255,.028)"; ctx.strokeStyle = "rgba(201,164,92,.27)"; ctx.lineWidth = 2;
      canvasRoundRect(ctx, x, y, boxW, boxH, 18); ctx.fill(); ctx.stroke();
      ctx.fillStyle = "#8f8068"; ctx.font = "800 19px Arial"; ctx.fillText(it[0], x + 24, y + 30);
      ctx.fillStyle = "#eee9df"; ctx.font = "700 23px Arial"; drawCanvasWrapped(ctx, it[1], x + 24, y + 67, boxW - 48, 23);
    });

    ctx.fillStyle = "#d3b06a"; ctx.font = "800 19px Arial"; ctx.textAlign = "center"; ctx.fillText(`KARSA IDENTITY  •  ${getIdentityId()}`, W / 2, H - 88);
    ctx.fillStyle = "#6f685e"; ctx.font = "600 15px Arial"; ctx.fillText("Valid for authorized internal use of PT Karsa Lifestyle Nusantara.", W / 2, H - 62);
    ctx.textAlign = "left";
  }

  function loadIdentityCanvasImage(url) {
    return new Promise(resolve => {
      if (!url) return resolve(null);
      const img = new Image();
      img.crossOrigin = "anonymous";
      img.onload = () => resolve(img);
      img.onerror = () => resolve(null);
      img.src = url;
    });
  }

  function roundRectCanvas(ctx, x, y, w, h, r) {
    const rr = Math.min(r, w/2, h/2);
    ctx.beginPath();
    ctx.moveTo(x + rr, y);
    ctx.arcTo(x + w, y, x + w, y + h, rr);
    ctx.arcTo(x + w, y + h, x, y + h, rr);
    ctx.arcTo(x, y + h, x, y, rr);
    ctx.arcTo(x, y, x + w, y, rr);
    ctx.closePath();
  }

  function drawCanvasWrapped(ctx, text, x, y, maxWidth, lineHeight) {
    const words = String(text || "—").split(/\s+/);
    let line = "";
    let yy = y;
    for (const word of words) {
      const test = line ? `${line} ${word}` : word;
      if (ctx.measureText(test).width > maxWidth && line) {
        ctx.fillText(line, x, yy);
        line = word;
        yy += lineHeight;
      } else line = test;
    }
    if (line) ctx.fillText(line, x, yy);
  }

  
function openProfile() {
    if (!state.user) return;
    ensureProfileUI();

    $("profileNameInput").value = state.user.name || "";
    $("profileEmailText").textContent = state.user.email || "—";
    $("profileTitleText").textContent = state.user.title || roleLabel(state.user.role);
    $("profileDivisionText").textContent = state.user.division || "—";
    renderProfileAvatar();
    $("karsaProfileModal").classList.remove("hidden");
  }

  function closeProfile() {
    $("karsaProfileModal")?.classList.add("hidden");
  }

  function renderProfileAvatar() {
    const el = $("profileAvatarPreview");
    if (!el || !state.user) return;
    el.textContent = state.user.avatarUrl ? "" : (state.user.initials || initials(state.user.name));
    el.style.backgroundImage = state.user.avatarUrl
      ? `url("${state.user.avatarUrl}")`
      : "";
  }

  async function saveProfile() {
    if (!client || !state.user) return;
    const name = $("profileNameInput").value.trim();
    if (!name) {
      showToast("Nama tidak boleh kosong.");
      return;
    }

    const { data, error } = await client.rpc("update_my_profile", {
      p_name: name,
      p_avatar_url: state.user.avatarUrl || null
    });

    if (error) {
      showToast(error.message || "Profil gagal diperbarui.");
      return;
    }

    state.user.name = data?.name || name;
    state.user.initials = initials(state.user.name);
    state.user.avatarUrl = data?.avatar_url || state.user.avatarUrl || "";
    renderAll();
    renderProfileAvatar();
    showToast("Profil berhasil diperbarui.");
  }

  function openCropper(file) {
    if (!file || !state.user) return;

    if (!file.type.startsWith("image/")) {
      showToast("File harus berupa gambar.");
      return;
    }

    if (file.size > 10 * 1024 * 1024) {
      showToast("Ukuran foto asli maksimal 10 MB.");
      return;
    }

    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () => {
        const canvas = $("karsaCropCanvas");
        const size = 512;
        const baseScale = Math.max(size / img.naturalWidth, size / img.naturalHeight);
        window.__karsaCrop = {
          img,
          canvas,
          size,
          baseScale,
          scale: 1,
          x: 0,
          y: 0,
          dragging: false,
          pointerId: null,
          lastX: 0,
          lastY: 0
        };
        $("karsaCropZoom").value = "1";
        drawCropper();
        $("karsaCropModal").classList.remove("hidden");
      };
      img.onerror = () => showToast("Foto tidak dapat dibaca.");
      img.src = reader.result;
    };
    reader.onerror = () => showToast("Foto tidak dapat dibaca.");
    reader.readAsDataURL(file);
  }

  function closeCropper() {
    $("karsaCropModal")?.classList.add("hidden");
    const c = window.__karsaCrop;
    if (c?.img?.src?.startsWith("blob:")) URL.revokeObjectURL(c.img.src);
    window.__karsaCrop = null;
  }

  function adjustCropZoom(delta) {
    const c = window.__karsaCrop;
    if (!c) return;
    c.scale = Math.min(3.5, Math.max(1, c.scale + delta));
    $("karsaCropZoom").value = String(c.scale);
    drawCropper();
  }

  function drawCropper() {
    const c = window.__karsaCrop;
    if (!c) return;
    const ctx = c.canvas.getContext("2d");
    const drawScale = c.baseScale * c.scale;
    const w = c.img.naturalWidth * drawScale;
    const h = c.img.naturalHeight * drawScale;

    ctx.clearRect(0, 0, c.size, c.size);
    ctx.fillStyle = "#111";
    ctx.fillRect(0, 0, c.size, c.size);
    ctx.drawImage(
      c.img,
      (c.size - w) / 2 + c.x,
      (c.size - h) / 2 + c.y,
      w,
      h
    );
  }

  async function useCroppedAvatar() {
    const c = window.__karsaCrop;
    if (!c || !client || !state.user) return;

    const canvas = c.canvas;
    canvas.toBlob(async blob => {
      if (!blob) {
        showToast("Foto gagal diproses.");
        return;
      }

      closeCropper();
      await uploadCroppedAvatar(blob);
    }, "image/jpeg", 0.92);
  }

  async function uploadCroppedAvatar(blob) {
    const path = `${state.user.id}/avatar-${Date.now()}.jpg`;
    const oldUrl = state.user.avatarUrl || "";
    const oldPath = avatarPathFromUrl(oldUrl);

    const { error: uploadError } = await client.storage
      .from(AVATAR_BUCKET)
      .upload(path, blob, {
        cacheControl: "3600",
        contentType: "image/jpeg",
        upsert: false
      });

    if (uploadError) {
      showToast(uploadError.message || "Foto gagal diupload.");
      return;
    }

    const { data: publicData } = client.storage
      .from(AVATAR_BUCKET)
      .getPublicUrl(path);

    const avatarUrl = `${publicData.publicUrl}?v=${Date.now()}`;
    const { data, error } = await client.rpc("update_my_profile", {
      p_name: state.user.name,
      p_avatar_url: avatarUrl
    });

    if (error) {
      await client.storage.from(AVATAR_BUCKET).remove([path]);
      showToast(error.message || "Profil gagal diperbarui.");
      return;
    }

    state.user.avatarUrl = data?.avatar_url || avatarUrl;
    renderUser();
    renderProfileAvatar();

    if (oldPath && oldPath !== path) {
      await client.storage.from(AVATAR_BUCKET).remove([oldPath]);
    }

    showToast("Foto profil berhasil diperbarui.");
  }

  async function removeAvatar() {
    if (!client || !state.user) return;

    const oldPath = avatarPathFromUrl(state.user.avatarUrl || "");
    const { data, error } = await client.rpc("update_my_profile", {
      p_name: state.user.name,
      p_avatar_url: null
    });

    if (error) {
      showToast(error.message || "Foto profil gagal dihapus.");
      return;
    }

    if (oldPath) {
      await client.storage.from(AVATAR_BUCKET).remove([oldPath]);
    }

    state.user.avatarUrl = data?.avatar_url || "";
    renderUser();
    renderProfileAvatar();
    showToast("Foto profil dihapus.");
  }

  /*
   * =========================================================
   * LOGIN
   * =========================================================
   */

  async function realLogin(
    email,
    password
  ) {
    const {
      data,
      error
    } =
      await client.auth.signInWithPassword(
        {
          email,
          password
        }
      );

    if (error) {
      throw error;
    }

    const uid =
      data.user.id;

    const {
      data: profile,
      error: pe
    } =
      await client
        .from("profiles")
        .select("*")
        .eq("id", uid)
        .single();

    if (pe || !profile) {
      throw new Error(
        "Akun berhasil login, tetapi profil internal belum dibuat."
      );
    }

    state.user = {
      id: uid,
      name: profile.name,
      email: profile.email,
      role: profile.role,
      division:
        profile.division,
      initials:
        initials(
          profile.name
        ),
      title:
        profile.title ||
        roleLabel(
          profile.role
        ),
      employeeId:
        profile.employee_id ||
        "",
      avatarUrl:
        profile.avatar_url ||
        ""
    };
  }

  /*
   * =========================================================
   * ENTER APP
   * =========================================================
   */

  async function enterApp() {
    $("loginPage").classList.add(
      "hidden"
    );

    $("app").classList.remove(
      "hidden"
    );

    await loadJobs();

    loadActivities();

    await loadAssignees();

    renderAll();

    showView(
      "dashboard"
    );
  }

  /*
   * =========================================================
   * LOGOUT
   * =========================================================
   */

  async function logout() {
    if (client) {
      await client.auth.signOut();
    }

    state.user = null;

    $("app").classList.add(
      "hidden"
    );

    $("loginPage").classList.remove(
      "hidden"
    );
  }

  /*
   * =========================================================
   * TOAST
   * =========================================================
   */

  function showToast(msg) {
    const t =
      $("toast");

    if (!t) return;

    t.textContent =
      msg;

    t.classList.add(
      "show"
    );

    clearTimeout(
      window.__toast
    );

    window.__toast =
      setTimeout(
        () =>
          t.classList.remove(
            "show"
          ),
        2600
      );
  }

  /*
   * =========================================================
   * EXPORT CSV
   * =========================================================
   */

  function exportCSV() {
    const rows = [
      [
        "ID",
        "Pekerjaan",
        "Divisi",
        "PIC",
        "Deadline",
        "Progress",
        "Status",
        "Prioritas",
        "Kendala",
        "Next Action"
      ],

      ...visibleJobs().map(
        j => [
          j.id,
          j.title,
          j.division,
          j.assignee,
          j.deadline,
          j.progress,
          j.status,
          j.priority,
          j.blocker,
          j.nextAction
        ]
      )
    ];

    const csv =
      rows
        .map(
          r =>
            r
              .map(
                v =>
                  `"${String(
                    v ?? ""
                  ).replaceAll(
                    '"',
                    '""'
                  )}"`
              )
              .join(",")
        )
        .join("\n");

    const a =
      document.createElement(
        "a"
      );

    a.href =
      URL.createObjectURL(
        new Blob(
          [csv],
          {
            type:
              "text/csv"
          }
        )
      );

    a.download =
      "karsa-weekly-review.csv";

    a.click();

    URL.revokeObjectURL(
      a.href
    );
  }

  /*
   * =========================================================
   * LOAD ASSIGNEES
   * =========================================================
   *
   * Director / GM / HDO dapat memilih:
   *
   * - General Manager
   * - Head Divisi Operasional
   * - Head Divisi
   * - Staff
   *
   * Director tidak dimasukkan sebagai PIC.
   */

  async function loadAssignees() {
    const select =
      document.querySelector(
        'select[name="assigneeId"]'
      );

    if (!select) return;

    if (!client) {
      select.innerHTML =
        '<option value="">Hubungkan Supabase untuk memilih akun</option>';

      return;
    }

    const {
      data,
      error
    } =
      await client
        .from("profiles")
        .select(
          "id,name,email,division,role"
        )
        .order(
          "division"
        )
        .order(
          "name"
        );

    if (error) {
      select.innerHTML =
        '<option value="">Gagal memuat akun</option>';

      return;
    }

    select.innerHTML =
      '<option value="">Pilih PIC...</option>' +

      data
        .filter(
          p =>
            [
              "general_manager",
              "operational_head",
              "division_head",
              "staff"
            ].includes(
              p.role
            )
        )
        .map(
          p =>
            `<option
              value="${p.id}"
              data-name="${esc(
                p.name
              )}"
              data-division="${esc(
                p.division
              )}"
            >
              ${esc(
                p.name
              )} •
              ${esc(
                p.division
              )} •
              ${roleLabel(
                p.role
              )}
            </option>`
        )
        .join("");
  }

  /*
   * =========================================================
   * BIND EVENTS
   * =========================================================
   */

  function bind() {

    ensureProfileUI();

    [$("sideAvatar"), $("sideName"), $("mobileAvatar")]
      .filter(Boolean)
      .forEach(el => {
        el.classList.add("karsa-profile-trigger");
        el.title = "Buka profil";
        el.addEventListener("click", openProfile);
      });

    document
      .querySelectorAll(
        ".nav-item"
      )
      .forEach(
        b =>
          b.addEventListener(
            "click",
            () =>
              showView(
                b.dataset.view
              )
          )
      );

    document
      .querySelectorAll(
        "[data-view-link]"
      )
      .forEach(
        b =>
          b.addEventListener(
            "click",
            () =>
              showView(
                b.dataset.viewLink
              )
          )
      );

    $("menuBtn").addEventListener(
      "click",
      () => {
        const sidebar = $("sidebar");
        if (sidebar?.classList.contains("open")) {
          closeKarsaSidebar();
        } else {
          openKarsaSidebar();
        }
      }
    );

    $("togglePass").addEventListener(
      "click",
      () => {
        $("loginPassword").type =
          $("loginPassword").type ===
          "password"
            ? "text"
            : "password";
      }
    );

    /*
     * LOGIN
     */

    $("loginForm").addEventListener(
      "submit",
      async e => {
        e.preventDefault();

        $("loginError").textContent =
          "";

        if (!client) {
          $("loginError").textContent =
            "Sistem belum terhubung ke Supabase. Hubungkan config.js terlebih dahulu.";

          return;
        }

        try {
          await realLogin(
            $(
              "loginEmail"
            ).value.trim(),

            $(
              "loginPassword"
            ).value
          );

          await enterApp();

        } catch (err) {
          $("loginError").textContent =
            err.message ||
            "Login gagal.";
        }
      }
    );

    /*
     * LOGOUT
     */

    $("logoutBtn").addEventListener(
      "click",
      logout
    );

    /*
     * SEARCH
     */

    $("searchJobs").addEventListener(
      "input",
      e => {
        state.filterText =
          e.target.value;

        renderJobs();
      }
    );

    /*
     * STATUS FILTER
     */

    $("statusFilter").addEventListener(
      "change",
      e => {
        state.filterStatus =
          e.target.value;

        renderJobs();
      }
    );

    /*
     * DIVISION FILTER
     */

    $("divisionFilter").addEventListener(
      "change",
      e => {
        state.filterDivision =
          e.target.value;

        renderJobs();
      }
    );

    /*
     * NEW JOB
     */

    $("newJobBtn").addEventListener(
      "click",
      () =>
        showView(
          "create"
        )
    );

    $("quickAdd").addEventListener(
      "click",
      () =>
        showView(
          "create"
        )
    );

    /*
     * JOB FORM
     *
     * PENTING:
     * sebelumnya memakai isOps()
     * yang tidak pernah didefinisikan.
     *
     * Sekarang menggunakan canAssign().
     */

    $("jobForm").addEventListener(
      "submit",
      async e => {
        e.preventDefault();

        if (!canAssign()) {
          showToast(
            "Akun ini tidak memiliki akses untuk memberikan pekerjaan."
          );

          return;
        }

        const f =
          new FormData(
            e.currentTarget
          );

        const opt =
          document.querySelector(
            'select[name="assigneeId"] option:checked'
          );

        const selectedDivision =
          f.get(
            "division"
          );

        const selectedAssigneeId =
          f.get(
            "assigneeId"
          );

        /*
         * Pastikan PIC dipilih
         */

        if (
          !selectedAssigneeId
        ) {
          showToast(
            "Pilih PIC terlebih dahulu."
          );

          return;
        }

        /*
         * Pastikan PIC berasal
         * dari divisi yang sama.
         */

        const picDivision =
          opt?.dataset
            .division || "";

        if (
          picDivision &&
          picDivision !==
            selectedDivision
        ) {
          showToast(
            "PIC harus berasal dari divisi tujuan."
          );

          return;
        }

        const ok =
          await createJob({
            title:
              f.get(
                "title"
              ),

            division:
              selectedDivision,

            assigneeId:
              selectedAssigneeId,

            assignee:
              opt?.dataset
                .name ||
              "",

            deadline:
              f.get(
                "deadline"
              ),

            priority:
              f.get(
                "priority"
              ),

            description:
              f.get(
                "description"
              ),

            nextAction:
              f.get(
                "nextAction"
              )
          });

        if (ok) {
          e.currentTarget.reset();

          $("routeDivision").textContent =
            "Finance";

          $("routePic").textContent =
            "PIC";

          renderAll();

          showView(
            "jobs"
          );
        }
      }
    );

    /*
     * DIVISION ROUTING
     */

    document
      .querySelector(
        'select[name="division"]'
      )
      .addEventListener(
        "change",
        e => {
          $("routeDivision").textContent =
            e.target.value;

          /*
           * Reset PIC agar tidak
           * salah divisi setelah
           * tujuan berubah.
           */

          const picSelect =
            document.querySelector(
              'select[name="assigneeId"]'
            );

          if (
            picSelect
          ) {
            picSelect.value =
              "";

            $("routePic").textContent =
              "PIC";
          }
        }
      );

    /*
     * PIC ROUTING
     */

    document
      .querySelector(
        'select[name="assigneeId"]'
      )
      .addEventListener(
        "change",
        e => {
          const opt =
            e.target
              .selectedOptions[0];

          $("routePic").textContent =
            opt?.dataset
              .name ||
            "PIC";
        }
      );

    /*
     * EXPORT
     */

    $("exportBtn").addEventListener(
      "click",
      exportCSV
    );

    /*
     * OPEN JOB / CLOSE MODAL
     */

    document.addEventListener(
      "click",
      e => {
        const b =
          e.target.closest(
            "[data-open-job]"
          );

        if (b) {
          openJob(
            b.dataset.openJob
          );
        }

        if (
          e.target.matches(
            "[data-close-modal]"
          ) ||
          e.target.closest(
            "[data-close-modal]"
          )
        ) {
          closeModal();
        }
      }
    );

    document.addEventListener("keydown", e => {
      if (e.key === "Escape") {
        closeModal();
        closeProfile();
      }
    });
  }

  /*
   * =========================================================
   * CLOCK
   * =========================================================
   */

  function tick() {
    $("clock").textContent =
      new Intl.DateTimeFormat(
        "id-ID",
        {
          hour: "2-digit",
          minute: "2-digit",
          second: "2-digit"
        }
      ).format(
        new Date()
      );
  }


  /*
   * =========================================================
   * KARSA WORKSPACE EXTENSIONS
   * Calendar • Analytics • Directory • Job Timeline
   * Comments • Attachments • Employee ID / Verification
   * =========================================================
   */

  function karsaExtStyles() {
    if ($("karsaExtStyle")) return;
    const style = document.createElement("style");
    style.id = "karsaExtStyle";
    style.textContent = `
      .karsa-ext-nav{margin:14px 12px 0;padding-top:14px;border-top:1px solid rgba(201,164,92,.14)}
      .karsa-ext-label{padding:0 12px 8px;color:#8d8a82;font-size:9px;font-weight:800;letter-spacing:.18em}
      .karsa-ext-nav button{width:100%;display:flex;align-items:center;gap:10px;border:0;background:transparent;color:inherit;padding:10px 12px;border-radius:12px;cursor:pointer;text-align:left;font:inherit;font-size:12px}
      .karsa-ext-nav button:hover{background:rgba(201,164,92,.08);color:#c9a45c}
      .karsa-ext-nav button span:first-child{width:22px;text-align:center}
      .karsa-ext-overlay{position:fixed;inset:0;z-index:9998;background:rgba(5,5,5,.76);backdrop-filter:blur(16px);display:flex;align-items:center;justify-content:center;padding:18px}
      .karsa-ext-overlay.hidden{display:none}
      .karsa-ext-shell{width:min(1120px,100%);max-height:92vh;overflow:auto;background:#f7f6f2;color:#161616;border:1px solid rgba(201,164,92,.35);border-radius:28px;box-shadow:0 35px 100px rgba(0,0,0,.48)}
      .karsa-ext-head{display:flex;align-items:flex-start;justify-content:space-between;gap:16px;padding:24px 26px 18px;border-bottom:1px solid #e6e2d9;position:sticky;top:0;background:rgba(247,246,242,.96);backdrop-filter:blur(10px);z-index:2}
      .karsa-ext-head small{display:block;color:#9b7b3f;font-size:9px;font-weight:800;letter-spacing:.2em;margin-bottom:5px}.karsa-ext-head h2{margin:0;font-family:Georgia,serif;font-size:28px}
      .karsa-ext-close{width:38px;height:38px;border:1px solid #ddd8ce;border-radius:50%;background:#fff;cursor:pointer;font-size:20px}
      .karsa-ext-body{padding:24px 26px 30px}.karsa-ext-toolbar{display:flex;flex-wrap:wrap;gap:10px;align-items:center;margin-bottom:18px}.karsa-ext-toolbar select,.karsa-ext-toolbar input{border:1px solid #ddd8ce;background:#fff;border-radius:11px;padding:10px 12px;font:inherit}
      .karsa-cal{display:grid;grid-template-columns:repeat(7,minmax(0,1fr));border:1px solid #e3dfd6;border-radius:18px;overflow:hidden;background:#fff}.karsa-cal-day{min-height:110px;padding:10px;border-right:1px solid #eeeae2;border-bottom:1px solid #eeeae2}.karsa-cal-day:nth-child(7n){border-right:0}.karsa-cal-head{min-height:auto;text-align:center;background:#faf8f3;font-size:10px;font-weight:800;letter-spacing:.08em;color:#777}.karsa-cal-num{font-weight:800;font-size:12px}.karsa-cal-num.today{display:inline-flex;width:25px;height:25px;align-items:center;justify-content:center;border-radius:50%;background:#c9a45c;color:#fff}.karsa-cal-job{margin-top:6px;padding:5px 6px;border-radius:8px;background:#f4efe4;border-left:2px solid #c9a45c;font-size:9px;line-height:1.3;cursor:pointer}.karsa-cal-job.blocked{border-left-color:#b44}.karsa-cal-job.done{opacity:.55}
      .karsa-kpi-grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:12px}.karsa-kpi{background:#fff;border:1px solid #e5e1d8;border-radius:18px;padding:18px}.karsa-kpi small{display:block;color:#888;font-size:9px;letter-spacing:.14em;font-weight:800}.karsa-kpi strong{display:block;font-size:28px;margin-top:8px}.karsa-analytics-grid{display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-top:16px}.karsa-panel{background:#fff;border:1px solid #e5e1d8;border-radius:18px;padding:18px}.karsa-panel h3{margin:0 0 14px;font-size:14px}.karsa-bar-row{margin:12px 0}.karsa-bar-label{display:flex;justify-content:space-between;font-size:11px;margin-bottom:6px}.karsa-bar-track{height:8px;border-radius:99px;background:#eee9df;overflow:hidden}.karsa-bar-track span{display:block;height:100%;background:#c9a45c;border-radius:99px}
      .karsa-people-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:14px}.karsa-person{background:#fff;border:1px solid #e5e1d8;border-radius:18px;padding:16px;display:flex;gap:12px;align-items:center}.karsa-person-avatar{width:52px;height:52px;border-radius:50%;background:#111;color:#fff;display:flex;align-items:center;justify-content:center;font-weight:800;background-size:cover;background-position:center;flex:0 0 52px}.karsa-person strong{display:block;font-size:12px}.karsa-person small{display:block;color:#777;margin-top:3px;font-size:10px}.karsa-person-id{font-family:monospace;color:#9b7b3f;font-size:9px!important}
      .karsa-job-extra{margin-top:18px;padding-top:18px;border-top:1px solid #eee}.karsa-extra-grid{display:grid;grid-template-columns:1fr 1fr;gap:14px}.karsa-extra-box{border:1px solid #e4e0d7;border-radius:15px;background:#faf9f6;padding:14px}.karsa-extra-box h4{margin:0 0 10px;font-size:12px}.karsa-timeline{display:grid;gap:9px;max-height:240px;overflow:auto}.karsa-timeline-item{display:grid;grid-template-columns:9px 1fr;gap:9px}.karsa-timeline-dot{width:8px;height:8px;border-radius:50%;background:#c9a45c;margin-top:5px}.karsa-timeline-item strong{font-size:10px}.karsa-timeline-item small{display:block;color:#777;font-size:9px;margin-top:2px}.karsa-comment-list{display:grid;gap:8px;max-height:220px;overflow:auto}.karsa-comment{padding:9px;border-radius:10px;background:#fff;border:1px solid #ece8df}.karsa-comment strong{font-size:10px}.karsa-comment p{font-size:10px;margin:4px 0 0;white-space:pre-wrap}.karsa-comment small{font-size:8px;color:#999}.karsa-comment-form{display:flex;gap:7px;margin-top:10px}.karsa-comment-form input{min-width:0;flex:1;border:1px solid #ddd8ce;border-radius:9px;padding:9px;font:inherit;font-size:10px}.karsa-mini-btn{border:1px solid #d9d2c5;background:#fff;border-radius:9px;padding:8px 10px;cursor:pointer;font-weight:700;font-size:10px}.karsa-mini-btn.gold{background:#c9a45c;border-color:#c9a45c;color:#fff}.karsa-file-list{display:grid;gap:7px;max-height:170px;overflow:auto}.karsa-file{display:flex;align-items:center;justify-content:space-between;gap:8px;padding:8px;background:#fff;border:1px solid #ece8df;border-radius:9px}.karsa-file-name{font-size:10px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.karsa-file-meta{font-size:8px;color:#999}.karsa-empty-mini{font-size:10px;color:#888;padding:10px 0}
      @media(max-width:800px){.karsa-kpi-grid{grid-template-columns:repeat(2,1fr)}.karsa-analytics-grid,.karsa-extra-grid{grid-template-columns:1fr}.karsa-people-grid{grid-template-columns:1fr 1fr}.karsa-cal-day{min-height:88px;padding:7px}.karsa-cal-job{font-size:8px}.karsa-ext-body{padding:18px}.karsa-ext-head{padding:18px}.karsa-ext-head h2{font-size:23px}}
      @media(max-width:520px){.karsa-people-grid{grid-template-columns:1fr}.karsa-kpi strong{font-size:23px}.karsa-cal-day{min-height:76px}.karsa-cal-job{padding:4px}.karsa-cal-day:not(.karsa-cal-head){font-size:9px}}
      /* KARSA UI BUG FIXES */
      #jobModal .modal-content,#jobModal .modal-card,#jobModal .modal-body,#jobModal #modalBody{color:#171717!important;background:#fff!important;}
      #jobModal label{color:#252525!important;font-weight:700;}
      #jobModal label small,#jobModal .update-info small{color:#6f6b63!important;}
      #jobModal input,#jobModal select,#jobModal textarea{color:#171717!important;background:#fff!important;border:1px solid #d9d5cd!important;}
      #jobModal input::placeholder,#jobModal textarea::placeholder{color:#999!important;}
      #jobModal input:disabled,#jobModal select:disabled,#jobModal textarea:disabled{color:#555!important;background:#f3f2ef!important;opacity:1!important;}
      #jobModal .update-info{background:#f7f5f0!important;color:#171717!important;border:1px solid #e5e0d6!important;}
      #jobModal .karsa-job-extra{color:#171717!important;background:transparent!important;}
      #jobModal .karsa-extra-box{color:#171717!important;background:#faf9f6!important;}
      #jobModal .karsa-extra-box h4{color:#252525!important;}
      #jobModal .karsa-timeline-item strong,#jobModal .karsa-comment strong,#jobModal .karsa-file-name{color:#252525!important;}
      #jobModal .karsa-timeline-item small,#jobModal .karsa-comment small,#jobModal .karsa-file-meta,#jobModal .karsa-empty-mini{color:#73706a!important;}
      #jobModal .karsa-comment p{color:#333!important;}
      #jobModal .karsa-comment-form input{color:#171717!important;background:#fff!important;}
      #jobModal .karsa-file{color:#171717!important;background:#fff!important;}
      #jobModal .karsa-mini-btn{color:#252525!important;background:#fff!important;}
      #jobModal .karsa-mini-btn.gold{color:#fff!important;background:#c9a45c!important;}
      /* WEEKLY REVIEW: force readable text on the dark workspace cards */
      #view-weekly .panel, #view-weekly .card, #view-weekly section, #view-weekly article{color:#f2f0eb!important;}
      #view-weekly h1,#view-weekly h2,#view-weekly h3,#view-weekly h4,#view-weekly h5,#view-weekly strong{color:#f2f0eb!important;}
      #view-weekly p,#view-weekly small,#view-weekly span,#view-weekly label{color:#c9c5bc!important;}
      #view-weekly .summary-line{color:#e8e5df!important;border-color:rgba(255,255,255,.08)!important;}
      #view-weekly .summary-line span:first-child{color:#e8e5df!important;}
      #view-weekly .summary-line span:last-child{color:#d3b06a!important;}
      #view-weekly .follow-item{color:#e8e5df!important;background:#171716!important;border-color:rgba(255,255,255,.10)!important;}
      #view-weekly .follow-item strong{color:#f3f1ec!important;}
      #view-weekly .follow-item small{color:#aaa69d!important;}
      /* Update Work: keep every interactive and extension area readable */
      #jobModal{color:#171717!important;}
      #jobModal .modal-content,#jobModal .modal-card,#jobModal .modal-body,#jobModal #modalBody{color:#171717!important;background:#fff!important;}
      #jobModal .update-grid{color:#171717!important;}
      #jobModal .form-actions{color:#171717!important;}
      #jobModal .karsa-job-extra{color:#171717!important;}
      #jobModal .karsa-extra-grid{display:grid;grid-template-columns:1fr 1fr;gap:14px;}
      #jobModal .karsa-extra-box{min-width:0;overflow:hidden;}
      #jobModal .karsa-extra-box h4{color:#242424!important;font-weight:800!important;letter-spacing:.03em;}
      #jobModal .karsa-timeline-item strong,#jobModal .karsa-comment strong,#jobModal .karsa-file-name{color:#252525!important;}
      #jobModal .karsa-timeline-item small,#jobModal .karsa-comment small,#jobModal .karsa-file-meta,#jobModal .karsa-empty-mini{color:#73706a!important;}
      #jobModal .karsa-comment p{color:#333!important;}
      #jobModal .karsa-comment-form input{color:#171717!important;background:#fff!important;}
      #jobModal .karsa-comment-form input::placeholder{color:#8b8880!important;opacity:1!important;}
      #jobModal .karsa-file{color:#171717!important;background:#fff!important;}
      #jobModal .karsa-file input[type=file]{color:#333!important;background:#fff!important;max-width:100%;font-size:11px;}
      #jobModal .karsa-mini-btn{color:#252525!important;background:#fff!important;}
      #jobModal .karsa-mini-btn.gold{color:#fff!important;background:#c9a45c!important;}
      .summary-line,.follow-item,.week-bar,.week-bar small{color:#242424!important;}
      .summary-line span:last-child{color:#8f6f34!important;font-weight:800;}
      .follow-item{background:#fff!important;border:1px solid #e7e2d9!important;}
      .follow-item strong{color:#202020!important;}
      .follow-item small{color:#666!important;}
      .week-bar span{background:#c9a45c!important;}
      .week-bar small{font-weight:700;}
      #logoutBtn{display:none!important;}
      .sidebar-backdrop{position:fixed;inset:0;background:rgba(0,0,0,.18);z-index:9990;display:none;pointer-events:none;}
      .sidebar-backdrop.show{display:block;pointer-events:auto;}
      #sidebar{z-index:9991;}
      .karsa-profile-logout{width:100%;margin-top:12px;border:1px solid #e2caca!important;background:#fff!important;color:#a33b3b!important;padding:12px 14px;border-radius:12px;cursor:pointer;font-weight:800;}
      .karsa-person-avatar-btn{border:0;padding:0;cursor:pointer;overflow:hidden;} .karsa-person-avatar-btn:focus{outline:2px solid rgba(201,164,92,.5);outline-offset:2px;}
      .karsa-person-avatar-btn img{width:100%;height:100%;object-fit:cover;display:block;} .karsa-person-avatar-btn span{width:100%;height:100%;align-items:center;justify-content:center;}
      .karsa-verify-person{display:flex;gap:12px;align-items:center;margin-bottom:12px;padding:14px;background:#fff;border:1px solid #e5e1d8;border-radius:16px;}
      .karsa-verify-photo{width:72px;height:72px;flex:0 0 72px;border-radius:16px;background:#111;color:#d3b06a;display:flex;align-items:center;justify-content:center;font-weight:800;overflow:hidden;}
      .karsa-verify-photo img{width:100%;height:100%;object-fit:cover;display:block;} .karsa-verify-photo span{width:100%;height:100%;align-items:center;justify-content:center;}
      .verify-success{color:#222!important;} .verify-success h3{color:#222!important;} .verify-success p{color:#666!important;margin:0;}
      .karsa-verify-person > div:last-child{min-width:0;flex:1 1 auto;}
      .karsa-verify-person > div:last-child strong{display:block!important;font-size:17px!important;line-height:1.2!important;color:#171717!important;white-space:normal!important;overflow-wrap:anywhere!important;}
      .karsa-verify-person > div:last-child small{display:block!important;margin-top:5px!important;font-size:12px!important;line-height:1.35!important;color:#65615a!important;white-space:normal!important;}
      .karsa-verify-person > div:last-child .karsa-person-id{font-family:ui-monospace,SFMono-Regular,Menlo,monospace!important;color:#9a7a3b!important;letter-spacing:.04em!important;}
      @media(max-width:520px){.karsa-verify-person{gap:12px;padding:13px}.karsa-verify-photo{width:76px;height:76px;flex-basis:76px}.karsa-verify-person > div:last-child strong{font-size:16px!important}.karsa-verify-person > div:last-child small{font-size:11px!important;}}
      .karsa-profile-logout:hover{background:#fff4f4!important;}
      .karsa-profile-meta strong{color:#222!important;text-align:right;}
      .karsa-profile-field input{color:#171717!important;background:#fff!important;}
      .karsa-profile-card{color:#171717!important;}
      .karsa-profile-note{color:#777!important;}
      .karsa-person-avatar{overflow:hidden;}
      .karsa-person-avatar img{width:100%;height:100%;object-fit:cover;display:block;}
      @media(max-width:700px){.karsa-extra-grid{grid-template-columns:1fr!important;}#jobModal .karsa-extra-box{grid-column:auto!important;}#jobModal .form-actions{position:sticky;bottom:0;background:#fff;padding-top:10px;z-index:3;}#jobModal .karsa-comment-form{flex-direction:column;}#jobModal .karsa-comment-form .karsa-mini-btn{width:100%;}#jobModal .karsa-file{align-items:flex-start;}#jobModal .karsa-file .karsa-mini-btn{flex:0 0 auto;}}
      /* V5 UX: robust Update Work scrolling, file picker, creator row, photo viewer, identity card */
      #jobModal{touch-action:pan-y!important;}
      #jobModal .modal-card{display:flex!important;flex-direction:column!important;height:calc(100dvh - 24px)!important;max-height:calc(100dvh - 24px)!important;overflow:hidden!important;}
      #jobModal #modalBody{flex:1 1 auto!important;min-height:0!important;overflow-y:auto!important;overflow-x:hidden!important;-webkit-overflow-scrolling:touch!important;overscroll-behavior:contain!important;touch-action:pan-y!important;padding-bottom:12px!important;}
      #jobModal .update-creator{display:flex;align-items:center;justify-content:space-between;gap:14px;margin:20px 0 0;padding:12px 14px;border-top:1px solid #ece8df;color:#222;background:#fbfaf7;border-radius:12px;}
      #jobModal .update-creator-label{font-size:9px;letter-spacing:.14em;color:#8c877e;font-weight:800;}
      #jobModal .update-creator strong{font-size:12px;color:#222;text-align:right;}
      #jobModal #updateFormActions{position:relative!important;display:flex!important;justify-content:flex-end!important;gap:10px!important;margin:14px 0 4px!important;padding:14px 0 4px!important;border-top:1px solid #ece8df!important;background:#fff!important;z-index:5!important;}
      #jobModal .karsa-files-box{min-width:0!important;overflow:hidden!important;}
      #jobModal .karsa-file-picker{display:flex;align-items:center;gap:10px;min-width:0;margin-top:12px;padding:10px;border:1px dashed #d9d2c5;border-radius:12px;background:#fffdf9;box-sizing:border-box;}
      #jobModal .karsa-file-pick-btn{display:inline-flex;align-items:center;justify-content:center;flex:0 0 auto;padding:9px 12px;border:1px solid #d5c7aa;border-radius:10px;background:#f7f1e5;color:#70572c;font-size:11px;font-weight:800;cursor:pointer;}
      #jobModal #karsaFileName{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:#77736c;font-size:10px;}
      #jobModal .karsa-file{min-width:0;}
      #jobModal .karsa-file > div:first-child{min-width:0;flex:1 1 auto;}
      #jobModal .karsa-file-name{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
      #jobModal .karsa-comment-form input{min-width:0;width:100%;box-sizing:border-box;}
      .karsa-photo-viewer{position:fixed;inset:0;z-index:10020;display:flex;align-items:center;justify-content:center;padding:20px;background:rgba(0,0,0,.82);backdrop-filter:blur(10px);}
      .karsa-photo-viewer.hidden{display:none;}
      .karsa-photo-viewer-card{position:relative;max-width:min(92vw,620px);max-height:92vh;text-align:center;}
      .karsa-photo-viewer-card img{display:block;max-width:92vw;max-height:78vh;width:auto;height:auto;object-fit:contain;border-radius:18px;box-shadow:0 30px 80px rgba(0,0,0,.5);background:#111;}
      .karsa-photo-viewer-close{position:absolute;right:-10px;top:-10px;width:38px;height:38px;border:1px solid rgba(255,255,255,.25);border-radius:50%;background:#fff;color:#222;font-size:22px;cursor:pointer;z-index:2;}
      .karsa-photo-viewer-name{margin-top:12px;color:#fff;font-size:12px;letter-spacing:.04em;}
      .karsa-profile-avatar{cursor:pointer!important;}
      .karsa-id-brand-wrap{display:flex;align-items:center;gap:10px;}
      .karsa-id-logo{width:30px;height:30px;border-radius:8px;object-fit:cover;border:1px solid rgba(211,176,106,.55);box-shadow:0 5px 14px rgba(0,0,0,.25);background:#111;}
      .karsa-id-brand{font-size:25px!important;}
      .karsa-id-face{isolation:isolate;}
      .karsa-id-top,.karsa-id-main,.karsa-id-bottom{z-index:1;}
      .karsa-id-controls button:last-child{background:#111;color:#d3b06a;border-color:#3f3625;}
      .karsa-identity-shell{scrollbar-width:thin;}
      .karsa-ext-overlay{background:rgba(5,5,5,.82)!important;}
      .karsa-ext-shell{background:#f7f6f2!important;color:#161616!important;}
      .karsa-ext-body{background:#f7f6f2!important;color:#161616!important;}
      @media(max-width:700px){
        #jobModal .modal-card{height:calc(100dvh - 10px)!important;max-height:calc(100dvh - 10px)!important;margin:5px auto 5px!important;}
        #jobModal #modalBody{padding:0 2px 14px!important;}
        #jobModal .update-creator{margin-left:0;margin-right:0;}
        #jobModal #updateFormActions{justify-content:stretch!important;}
        #jobModal #updateFormActions button{flex:1 1 0!important;min-height:48px!important;}
        #jobModal .karsa-file-picker{align-items:flex-start;flex-wrap:wrap;}
        #jobModal .karsa-file-pick-btn{width:auto;}
        #jobModal #karsaFileName{flex:1 1 140px;white-space:normal;word-break:break-word;}
      }

      /* FINAL UX PASS: scroll-safe Update Work */
      body.karsa-job-open{overflow:hidden!important;}
      #jobModal{overflow-y:auto!important;overflow-x:hidden!important;-webkit-overflow-scrolling:touch!important;align-items:flex-start!important;justify-content:center!important;padding:18px 12px 42px!important;box-sizing:border-box!important;}
      #jobModal .modal-content,#jobModal .modal-card{height:auto!important;max-height:none!important;overflow:visible!important;box-sizing:border-box!important;margin:18px auto!important;}
      #jobModal .modal-body,#jobModal #modalBody{height:auto!important;max-height:none!important;overflow:visible!important;}
      #jobModal .karsa-job-extra{padding-bottom:8px!important;}
      #jobModal .karsa-extra-box{overflow:visible!important;}
      #jobModal .karsa-timeline,#jobModal .karsa-comment-list,#jobModal .karsa-file-list{overscroll-behavior:contain;-webkit-overflow-scrolling:touch;}
      @media(max-width:700px){
        body.karsa-job-open{overflow:hidden!important;}
        #jobModal{padding:8px 8px 30px!important;align-items:flex-start!important;}
        #jobModal .modal-content,#jobModal .modal-card{width:100%!important;max-width:100%!important;margin:8px auto 24px!important;border-radius:24px!important;}
        #jobModal .form-actions{position:sticky!important;bottom:0!important;margin-top:16px!important;padding:12px 0 max(10px,env(safe-area-inset-bottom))!important;background:linear-gradient(to bottom,rgba(255,255,255,.82),#fff 22%)!important;}
      }

      /* WEEKLY: keep the chart inside its column */
      #view-weekly #weekBars{display:flex!important;align-items:flex-end!important;justify-content:space-between!important;gap:clamp(4px,1.2vw,12px)!important;width:100%!important;min-width:0!important;max-width:100%!important;box-sizing:border-box!important;overflow:hidden!important;padding:0 4px!important;}
      #view-weekly #weekBars .week-bar{flex:1 1 0!important;width:auto!important;min-width:0!important;max-width:46px!important;height:132px!important;display:flex!important;flex-direction:column!important;align-items:center!important;justify-content:flex-end!important;overflow:hidden!important;box-sizing:border-box!important;}
      #view-weekly #weekBars .week-bar span{display:block!important;width:min(30px,70%)!important;max-width:30px!important;min-height:8px!important;max-height:106px!important;flex:0 0 auto!important;border-radius:8px 8px 2px 2px!important;box-sizing:border-box!important;}
      #view-weekly #weekBars .week-bar small{display:block!important;height:16px!important;line-height:16px!important;margin-top:6px!important;white-space:nowrap!important;}
      /* Weekly follow-up: lighter, less rigid */
      #view-weekly .follow-item{background:transparent!important;border:0!important;border-bottom:1px solid rgba(255,255,255,.09)!important;border-radius:0!important;padding:14px 4px!important;}
      #view-weekly .follow-item:last-child{border-bottom:0!important;}
      #view-weekly .follow-item strong{font-weight:700!important;}
      #view-weekly .follow-item small{display:block!important;line-height:1.55!important;margin-top:5px!important;}

      /* Profile: restore restrained KARSA look */
      .karsa-profile-modal{background:rgba(8,8,8,.52)!important;backdrop-filter:blur(8px)!important;padding:16px!important;}
      .karsa-profile-card{width:min(420px,100%)!important;border-radius:22px!important;padding:22px!important;box-shadow:0 22px 60px rgba(0,0,0,.22)!important;}
      .karsa-profile-head{margin-bottom:18px!important;}
      .karsa-profile-head h2{font-size:22px!important;font-family:Georgia,serif!important;font-weight:600!important;}
      .karsa-profile-avatar-wrap{margin:2px 0 16px!important;}
      .karsa-profile-avatar{width:92px!important;height:92px!important;font-size:26px!important;border-width:3px!important;box-shadow:0 8px 24px rgba(0,0,0,.12)!important;}
      .karsa-profile-actions{justify-content:center!important;gap:8px!important;margin-bottom:18px!important;}
      .karsa-profile-btn{padding:9px 12px!important;border-radius:10px!important;font-size:12px!important;font-weight:600!important;background:#fff!important;color:#333!important;}
      .karsa-profile-btn.gold{background:#c9a45c!important;border-color:#c9a45c!important;color:#fff!important;}
      .karsa-profile-btn.identity{background:#fff!important;color:#6f5729!important;border-color:#ddd5c5!important;}
      .karsa-profile-btn.danger{color:#777!important;border-color:#ddd!important;}
      .karsa-profile-meta{margin-top:16px!important;padding:4px 0!important;background:transparent!important;border-top:1px solid #eeeae2!important;border-bottom:1px solid #eeeae2!important;border-radius:0!important;}
      .karsa-profile-meta div{padding:10px 0!important;font-size:12px!important;border-bottom:1px solid #f0ede7!important;}
      .karsa-profile-meta div:last-child{border-bottom:0!important;}
      .karsa-profile-meta span:first-child{color:#888!important;}
      .karsa-profile-meta strong{font-weight:650!important;color:#222!important;}
      .karsa-profile-note{font-size:10px!important;margin-top:10px!important;color:#999!important;}
      .karsa-profile-footer{display:grid!important;grid-template-columns:1fr 1fr!important;gap:8px!important;margin-top:18px!important;}
      .karsa-profile-footer #openIdentityCardBtn{grid-column:1/-1!important;}
      .karsa-profile-logout{margin-top:16px!important;padding:11px 12px!important;background:transparent!important;border:0!important;border-top:1px solid #eeeae2!important;border-radius:0!important;color:#888!important;font-weight:600!important;}
      .karsa-profile-logout:hover{background:transparent!important;color:#8b4d4d!important;}
      @media(max-width:480px){.karsa-profile-card{padding:20px!important;border-radius:20px!important}.karsa-profile-footer{grid-template-columns:1fr 1fr!important}.karsa-profile-footer #openIdentityCardBtn{grid-column:1/-1!important}}
    `;
    document.head.appendChild(style);
  }

  function karsaEmployeeId(p) {
    const stored = normalizeKarsaEmployeeId(p?.employee_id, p?.division);
    if (stored) return stored;
    const division = normalizeKarsaDivision(p?.division);
    const code = ({Finance:"FIN",IT:"IT",Operasional:"OPS","R&D":"RND"})[division] || "KRS";
    const raw = String(p?.id || "").replace(/-/g, "").slice(0,6).toUpperCase() || "000000";
    return `KRSA-${code}-${raw}`;
  }

  function closeKarsaSidebar() {
    const sidebar = $("sidebar");
    if (sidebar) sidebar.classList.remove("open");
    const backdrop = $("sidebarBackdrop");
    if (backdrop) backdrop.classList.remove("show");
    document.body.classList.remove("sidebar-open");
  }

  function openKarsaSidebar() {
    const sidebar = $("sidebar");
    const backdrop = $("sidebarBackdrop");
    if (!sidebar) return;
    sidebar.classList.add("open");
    backdrop?.classList.add("show");
    document.body.classList.add("sidebar-open");
  }

  function karsaAddNav() {
    if ($("karsaExtNav")) return;
    const sidebar = $("sidebar");
    if (!sidebar) return;
    if (!$("sidebarBackdrop")) {
      const backdrop = document.createElement("div");
      backdrop.id = "sidebarBackdrop";
      backdrop.className = "sidebar-backdrop";
      document.body.appendChild(backdrop);
      backdrop.addEventListener("click", () => closeKarsaSidebar());
    }
    const wrap = document.createElement("div");
    wrap.id = "karsaExtNav";
    wrap.className = "karsa-ext-nav";
    wrap.innerHTML = `
      <div class="karsa-ext-label">CONTROL TOOLS</div>
      <button type="button" data-karsa-ext="calendar"><span>▦</span><span>Calendar</span></button>
      <button type="button" data-karsa-ext="analytics"><span>◫</span><span>Analytics</span></button>
      <button type="button" data-karsa-ext="directory"><span>◎</span><span>People Directory</span></button>`;
    sidebar.appendChild(wrap);
    wrap.addEventListener("click", e => {
      const b = e.target.closest("[data-karsa-ext]");
      if (b) { closeKarsaSidebar(); openKarsaExtension(b.dataset.karsaExt); }
    });
  }

  function karsaMakeOverlay() {
    if ($("karsaExtOverlay")) return;
    const el = document.createElement("div");
    el.id = "karsaExtOverlay";
    el.className = "karsa-ext-overlay hidden";
    el.innerHTML = `<div class="karsa-ext-shell"><div class="karsa-ext-head"><div><small id="karsaExtEyebrow">KARSA</small><h2 id="karsaExtTitle">Control Center</h2></div><button class="karsa-ext-close" type="button" data-karsa-ext-close>×</button></div><div id="karsaExtBody" class="karsa-ext-body"></div></div>`;
    document.body.appendChild(el);
    el.addEventListener("click", e => {
      if (e.target === el || e.target.closest("[data-karsa-ext-close]")) closeKarsaExtension();
    });
  }

  function closeKarsaExtension(){ $("karsaExtOverlay")?.classList.add("hidden"); }

  function karsaElegantInteractionStyle(){
    if($("karsaElegantInteractionStyle")) return;
    const style=document.createElement("style");
    style.id="karsaElegantInteractionStyle";
    style.textContent=`
      button,a,label,input,select,textarea,.nav-item,.mobile-menu-btn,.karsa-person-avatar-btn,.karsa-profile-avatar{
        -webkit-tap-highlight-color:transparent!important;
      }
      button:focus,a:focus,label:focus{outline:none!important;}
      button::-moz-focus-inner{border:0;}
      .karsa-ext-nav button,.karsa-profile-btn,.karsa-id-controls button,.karsa-mini-btn,.nav-item,.mobile-menu-btn{
        transition:background-color .24s ease,border-color .24s ease,color .24s ease,box-shadow .24s ease,transform .18s ease;
      }
      .karsa-ext-nav button:active,.karsa-profile-btn:active,.karsa-id-controls button:active,.karsa-mini-btn:active,.nav-item:active{transform:translateY(1px);}
      #karsaExtOverlay:not(.hidden){animation:karsaControlReveal .42s cubic-bezier(.22,.8,.22,1) both;}
      #karsaExtOverlay:not(.hidden) .karsa-ext-shell{animation:karsaControlShell .42s cubic-bezier(.22,.8,.22,1) both;}
      @keyframes karsaControlReveal{from{opacity:0;}to{opacity:1;}}
      @keyframes karsaControlShell{from{opacity:0;transform:translateY(16px) scale(.985);filter:blur(3px);}to{opacity:1;transform:none;filter:none;}}
    `;
    document.head.appendChild(style);
  }

  function openKarsaExtension(type){
    if (!state.user) return;
    karsaMakeOverlay();
    closeKarsaSidebar();
    const overlay=$("karsaExtOverlay");
    overlay.classList.remove("hidden");
    window.clearTimeout(window.__karsaExtDelay);
    // Deliberate micro-delay: close the sidebar first, then reveal the control tool smoothly.
    // This prevents the content from appearing instantly and makes the transition feel intentional.
    window.__karsaExtDelay=window.setTimeout(()=>{
      if(type === "calendar") renderKarsaCalendar();
      if(type === "analytics") renderKarsaAnalytics();
      if(type === "directory") renderKarsaDirectory();
    },420);
  }

  function renderKarsaCalendar(){
    $("karsaExtEyebrow").textContent="DEADLINE CENTER";
    $("karsaExtTitle").textContent="Calendar";
    const now = window.__karsaCalendarDate instanceof Date ? window.__karsaCalendarDate : new Date();
    const year=now.getFullYear(), month=now.getMonth();
    window.__karsaCalendarDate=new Date(year,month,1);
    const first=new Date(year,month,1), last=new Date(year,month+1,0);
    const start=(first.getDay()+6)%7;
    const total=last.getDate();
    const names=["Sen","Sel","Rab","Kam","Jum","Sab","Min"];
    const monthName=new Intl.DateTimeFormat("id-ID",{month:"long",year:"numeric"}).format(first);
    let html=`<div class="karsa-ext-toolbar"><button class="karsa-mini-btn" id="kCalPrev">←</button><strong style="min-width:150px;text-align:center">${monthName}</strong><button class="karsa-mini-btn" id="kCalNext">→</button><button class="karsa-mini-btn" id="kCalToday">Hari ini</button></div><div class="karsa-cal">${names.map(n=>`<div class="karsa-cal-day karsa-cal-head">${n}</div>`).join("")}`;
    for(let i=0;i<start;i++) html+=`<div class="karsa-cal-day"></div>`;
    for(let d=1;d<=total;d++){
      const iso=`${year}-${String(month+1).padStart(2,"0")}-${String(d).padStart(2,"0")}`;
      const jobs=visibleJobs().filter(j=>j.deadline===iso).slice(0,4);
      const isToday=iso===today();
      html+=`<div class="karsa-cal-day"><div class="karsa-cal-num ${isToday?"today":""}">${d}</div>${jobs.map(j=>`<div class="karsa-cal-job ${j.status==="Selesai"?"done":""} ${j.status==="Terkendala"?"blocked":""}" data-open-ext-job="${esc(j.id)}"><b>${esc(j.assignee||"")}</b><br>${esc(j.title)}</div>`).join("")}</div>`;
    }
    html+=`</div>`;
    $("karsaExtBody").innerHTML=html;
    $("kCalPrev").onclick=()=>{window.__karsaCalendarDate=new Date(year,month-1,1);renderKarsaCalendar()};
    $("kCalNext").onclick=()=>{window.__karsaCalendarDate=new Date(year,month+1,1);renderKarsaCalendar()};
    $("kCalToday").onclick=()=>{window.__karsaCalendarDate=new Date();renderKarsaCalendar()};
    $("karsaExtBody").querySelectorAll("[data-open-ext-job]").forEach(b=>b.onclick=()=>{closeKarsaExtension();openJob(b.dataset.openExtJob)});
  }

  function renderKarsaAnalytics(){
    $("karsaExtEyebrow").textContent="EXECUTIVE INSIGHTS";
    $("karsaExtTitle").textContent="Analytics";
    const jobs=visibleJobs(), total=jobs.length;
    const done=jobs.filter(j=>j.status==="Selesai").length;
    const blocked=jobs.filter(j=>j.status==="Terkendala").length;
    const late=jobs.filter(j=>j.deadline&&j.deadline<today()&&j.status!=="Selesai").length;
    const avg=total?Math.round(jobs.reduce((a,j)=>a+j.progress,0)/total):0;
    const divisions=["Finance","IT","Operasional","R&D"];
    const status=["Belum Mulai","In Progress","Menunggu","Terkendala","Siap Review","Selesai"];
    $("karsaExtBody").innerHTML=`<div class="karsa-kpi-grid"><div class="karsa-kpi"><small>TOTAL JOB</small><strong>${total}</strong></div><div class="karsa-kpi"><small>AVG PROGRESS</small><strong>${avg}%</strong></div><div class="karsa-kpi"><small>SELESAI</small><strong>${done}</strong></div><div class="karsa-kpi"><small>TERKENDALA / LATE</small><strong>${blocked} / ${late}</strong></div></div><div class="karsa-analytics-grid"><div class="karsa-panel"><h3>Progress per Divisi</h3>${divisions.map(d=>{const a=jobs.filter(j=>j.division===d);const p=a.length?Math.round(a.reduce((x,j)=>x+j.progress,0)/a.length):0;return `<div class="karsa-bar-row"><div class="karsa-bar-label"><span>${d}</span><b>${a.length} job • ${p}%</b></div><div class="karsa-bar-track"><span style="width:${p}%"></span></div></div>`}).join("")}</div><div class="karsa-panel"><h3>Status Pekerjaan</h3>${status.map(s=>{const n=jobs.filter(j=>j.status===s).length;const p=total?Math.round(n/total*100):0;return `<div class="karsa-bar-row"><div class="karsa-bar-label"><span>${s}</span><b>${n}</b></div><div class="karsa-bar-track"><span style="width:${p}%"></span></div></div>`}).join("")}</div></div>`;
  }

  async function renderKarsaDirectory(){
    $("karsaExtEyebrow").textContent="KARSA PEOPLE";
    $("karsaExtTitle").textContent="People Directory";
    $("karsaExtBody").innerHTML=`<div class="karsa-ext-toolbar"><input id="kPeopleSearch" placeholder="Cari nama, divisi, jabatan..." /></div><div id="kPeopleGrid" class="karsa-people-grid"><div class="karsa-empty-mini">Memuat data...</div></div>`;
    if (!client) { renderPeople([]); return; }
    const {data,error}=await client.from("profiles").select("id,name,email,division,role,title,avatar_url,employee_id").order("name");
    if(error){renderPeople([]);showToast(error.message);return;}
    window.__karsaPeople=data||[];
    renderPeople(window.__karsaPeople);
    $("kPeopleSearch").oninput=e=>{const q=e.target.value.toLowerCase();renderPeople(window.__karsaPeople.filter(p=>`${p.name} ${p.division} ${p.title} ${p.email}`.toLowerCase().includes(q)))};
  }

  function openPhotoViewer(url, name) {
    if (!url) return;
    let viewer = $("karsaDirectoryPhotoViewer");
    if (!viewer) {
      viewer = document.createElement("div");
      viewer.id = "karsaDirectoryPhotoViewer";
      viewer.className = "karsa-photo-viewer hidden";
      viewer.innerHTML = `<div class="karsa-photo-viewer-card"><button type="button" class="karsa-photo-viewer-close" aria-label="Tutup">×</button><img id="karsaDirectoryPhotoImg" alt="Foto profil"><div id="karsaDirectoryPhotoName" class="karsa-photo-viewer-name"></div></div>`;
      document.body.appendChild(viewer);
      viewer.addEventListener("click", e => {
        if (e.target === viewer || e.target.closest(".karsa-photo-viewer-close")) viewer.classList.add("hidden");
      });
    }
    $("karsaDirectoryPhotoImg").src = url;
    $("karsaDirectoryPhotoName").textContent = name || "Foto Profil";
    viewer.classList.remove("hidden");
  }

  function renderPeople(people){
    const grid=$("kPeopleGrid"); if(!grid)return;
    grid.innerHTML=people.length?people.map(p=>{
      const id=karsaEmployeeId(p);
      const photo=p.avatar_url||"";
      const fallback=esc(initials(p.name));
      return `<article class="karsa-person"><button type="button" class="karsa-person-avatar karsa-person-avatar-btn" data-directory-photo="${esc(photo)}" data-directory-name="${esc(p.name||"Karyawan")}" aria-label="Lihat foto ${esc(p.name||"karyawan")}">${photo?`<img src="${esc(photo)}" alt="" loading="lazy" onerror="this.style.display='none';this.nextElementSibling.style.display='flex'">`:``}<span style="display:${photo?"none":"flex"}">${fallback}</span></button><div><strong>${esc(p.name||"—")}</strong><small>${esc(p.title||roleLabel(p.role)||"—")}</small><small>${esc(p.division||"—")}</small><small class="karsa-person-id">${esc(id)}</small></div></article>`;
    }).join(""):"<div class=\"karsa-empty-mini\">Tidak ada data.</div>";
    grid.querySelectorAll("[data-directory-photo]").forEach(b=>b.addEventListener("click",()=>openPhotoViewer(b.dataset.directoryPhoto,b.dataset.directoryName)));
  }

  async function loadJobExtras(job){
    if (!client || !$("modalBody")) return;
    const wrap=document.createElement("div");
    wrap.id="karsaJobExtras";wrap.className="karsa-job-extra";
    wrap.innerHTML=`<div class="karsa-extra-grid"><section class="karsa-extra-box"><h4>RIWAYAT PERUBAHAN</h4><div id="karsaTimeline" class="karsa-timeline"><div class="karsa-empty-mini">Memuat...</div></div></section><section class="karsa-extra-box"><h4>KOMENTAR</h4><div id="karsaComments" class="karsa-comment-list"><div class="karsa-empty-mini">Memuat...</div></div><div class="karsa-comment-form"><input id="karsaCommentInput" maxlength="1000" placeholder="Tulis komentar..."/><button id="karsaCommentSend" class="karsa-mini-btn gold">Kirim</button></div></section><section class="karsa-extra-box karsa-files-box" style="grid-column:1/-1"><h4>FILE PEKERJAAN</h4><div id="karsaFiles" class="karsa-file-list"><div class="karsa-empty-mini">Memuat...</div></div><div class="karsa-file-picker"><label for="karsaFileInput" class="karsa-file-pick-btn">Pilih file</label><span id="karsaFileName">Belum ada file dipilih</span><input id="karsaFileInput" type="file" hidden /></div></section></div>`;
    $("modalBody").appendChild(wrap);
    await Promise.all([loadJobTimeline(job),loadJobComments(job),loadJobFiles(job)]);
    const actions = $("updateFormActions");
    if (actions && wrap.parentElement) wrap.parentElement.appendChild(actions);
    $("karsaCommentSend")?.addEventListener("click",()=>postJobComment(job));
    $("karsaCommentInput")?.addEventListener("keydown",e=>{if(e.key==="Enter"&&!e.shiftKey){e.preventDefault();postJobComment(job)}});
    $("karsaFileInput")?.addEventListener("change",e=>{const f=e.target.files?.[0];if(f){$("karsaFileName").textContent=f.name;uploadJobFile(job,f);}e.target.value=""});
  }

  async function loadJobTimeline(job){
    const box=$("karsaTimeline"); if(!box)return;
    const {data,error}=await client.from("progress_history").select("*").eq("job_id",job.id).order("created_at",{ascending:false}).limit(30);
    if(error){box.innerHTML=`<div class="karsa-empty-mini">Riwayat belum tersedia.</div>`;return;}
    const rows=data||[];
    box.innerHTML=rows.length?rows.map(x=>`<div class="karsa-timeline-item"><span class="karsa-timeline-dot"></span><div><strong>${esc(x.status||"Update")} • ${Number(x.progress||0)}%</strong><small>${esc(x.note||"Tidak ada catatan")} • ${x.created_at?new Date(x.created_at).toLocaleString("id-ID"):"—"}</small></div></div>`).join(""):"<div class=\"karsa-empty-mini\">Belum ada riwayat update.</div>";
  }

  async function loadJobComments(job){
    const box=$("karsaComments");if(!box)return;
    const {data,error}=await client.from("job_comments").select("id,body,user_id,created_at").eq("job_id",job.id).order("created_at",{ascending:false}).limit(50);
    if(error){box.innerHTML=`<div class="karsa-empty-mini">Komentar belum tersedia. Jalankan SQL fitur lanjutan.</div>`;return;}
    const rows=data||[];let names={};const ids=[...new Set(rows.map(x=>x.user_id).filter(Boolean))];if(ids.length){const r=await client.from("profiles").select("id,name").in("id",ids);(r.data||[]).forEach(p=>names[p.id]=p.name)}
    box.innerHTML=rows.length?rows.map(x=>`<div class="karsa-comment"><strong>${esc(names[x.user_id]||"KARSA User")}</strong><small> • ${x.created_at?new Date(x.created_at).toLocaleString("id-ID"):"—"}</small><p>${esc(x.body)}</p></div>`).join(""):"<div class=\"karsa-empty-mini\">Belum ada komentar.</div>";
  }

  async function postJobComment(job){
    const input=$("karsaCommentInput");const body=input?.value.trim();if(!body)return;
    const {error}=await client.from("job_comments").insert({job_id:job.id,user_id:state.user.id,body});
    if(error){showToast(error.message);return;} input.value="";await loadJobComments(job);showToast("Komentar ditambahkan.");
  }

  async function loadJobFiles(job){
    const box=$("karsaFiles");if(!box)return;
    const {data,error}=await client.from("job_attachments").select("id,file_name,file_path,file_size,mime_type,uploaded_by,created_at").eq("job_id",job.id).order("created_at",{ascending:false});
    if(error){box.innerHTML=`<div class="karsa-empty-mini">Attachment belum tersedia. Jalankan SQL fitur lanjutan.</div>`;return;}
    const rows=data||[];
    box.innerHTML=rows.length?rows.map(x=>`<div class="karsa-file"><div style="min-width:0"><div class="karsa-file-name">${esc(x.file_name)}</div><div class="karsa-file-meta">${Math.max(1,Math.round((x.file_size||0)/1024))} KB • ${x.created_at?new Date(x.created_at).toLocaleString("id-ID"):"—"}</div></div><button class="karsa-mini-btn" data-download-file="${esc(x.id)}">Buka</button></div>`).join(""):"<div class=\"karsa-empty-mini\">Belum ada file.</div>";
    box.querySelectorAll("[data-download-file]").forEach(b=>b.onclick=()=>downloadJobFile(b.dataset.downloadFile));
  }

  async function uploadJobFile(job,file){
    if(file.size>15*1024*1024){showToast("File maksimal 15 MB.");return;}
    const safe=file.name.replace(/[^a-zA-Z0-9._-]/g,"_");const path=`${job.id}/${crypto.randomUUID()}-${safe}`;
    const {error:up}=await client.storage.from("job-files").upload(path,file,{cacheControl:"3600",upsert:false,contentType:file.type||"application/octet-stream"});
    if(up){showToast(up.message);return;}
    const {error:db}=await client.from("job_attachments").insert({job_id:job.id,file_name:file.name,file_path:path,file_size:file.size,mime_type:file.type||"application/octet-stream",uploaded_by:state.user.id});
    if(db){await client.storage.from("job-files").remove([path]);showToast(db.message);return;}
    await loadJobFiles(job);showToast("File berhasil diunggah.");
  }

  async function downloadJobFile(id){
    const {data,error}=await client.from("job_attachments").select("file_name,file_path").eq("id",id).single();
    if(error||!data){showToast(error?.message||"File tidak ditemukan.");return;}
    const r=await client.storage.from("job-files").createSignedUrl(data.file_path,300);
    if(r.error){showToast(r.error.message);return;}
    window.open(r.data.signedUrl,"_blank","noopener");
  }

  function karsaVerifyModal(){
    if($("karsaVerifyModal"))return;
    const el=document.createElement("div");el.id="karsaVerifyModal";el.className="karsa-ext-overlay hidden";el.innerHTML=`<div class="karsa-ext-shell" style="max-width:560px"><div class="karsa-ext-head"><div><small>IDENTITY VERIFICATION</small><h2>KARSA ID Verification</h2></div><button class="karsa-ext-close" data-kv-close>×</button></div><div id="karsaVerifyBody" class="karsa-ext-body"></div></div>`;document.body.appendChild(el);el.addEventListener("click",e=>{if(e.target===el||e.target.closest("[data-kv-close]"))el.classList.add("hidden")});
  }

  async function handleKarsaVerifyQuery(){
    const rawId=new URLSearchParams(location.search).get("verify");if(!rawId)return;
    const id=String(rawId).replace(/^KRSA-ITIT-/i,"KRSA-IT-");
    karsaVerifyModal();$("karsaVerifyModal").classList.remove("hidden");$("karsaVerifyBody").innerHTML=`<div class="karsa-empty-mini">Memverifikasi ${esc(id)}...</div>`;
    if(!client){$("karsaVerifyBody").innerHTML=`<div class="karsa-panel"><h3>Verification unavailable</h3><p>Sistem belum terhubung.</p></div>`;return;}
    const {data,error}=await client.rpc("verify_employee",{p_employee_id:id});
    if(error||!data){$("karsaVerifyBody").innerHTML=`<div class="karsa-panel"><h3>Identity not verified</h3><p>ID <b>${esc(id)}</b> tidak ditemukan atau tidak aktif.</p></div>`;return;}
    const p = Array.isArray(data) ? data[0] : data;
    if(!p){$("karsaVerifyBody").innerHTML=`<div class="karsa-panel"><h3>Identity not verified</h3><p>ID <b>${esc(id)}</b> tidak ditemukan atau tidak aktif.</p></div>`;return;}
    const photo = p.avatar_url || "";
    const division = normalizeKarsaDivision(p.division);
    const employeeId = String(p.employee_id || id).replace(/^KRSA-ITIT-/i,"KRSA-IT-");
    $("karsaVerifyBody").innerHTML = `<div class="karsa-verify-person"><div class="karsa-verify-photo">${photo ? `<img src="${esc(photo)}" alt="Foto ${esc(p.name || "karyawan")}" onerror="this.style.display='none';this.nextElementSibling.style.display='flex'">` : ""}<span style="display:${photo ? "none" : "flex"}">${esc(initials(p.name))}</span></div><div><strong>${esc(p.name || "—")}</strong><small>${esc(p.title || roleLabel(p.role) || "—")}</small><small>Divisi ${esc(division)}</small><small class="karsa-person-id">${esc(employeeId)}</small></div></div><div class="karsa-panel verify-success"><h3>✓ Identity Verified</h3><p>Data identitas ditemukan pada sistem KARSA.</p></div>`;
  }

  function bindJobModalTouchScroll(){
    const body=$("modalBody"); if(!body || body.dataset.touchScrollBound) return;
    body.dataset.touchScrollBound="1";
    let lastY=0; let active=false;
    body.addEventListener("touchstart",e=>{ if(!e.touches?.length)return; lastY=e.touches[0].clientY; active=true; },{passive:true});
    body.addEventListener("touchmove",e=>{
      if(!active || !e.touches?.length) return;
      const y=e.touches[0].clientY; const dy=lastY-y;
      if(Math.abs(dy)>1 && body.scrollHeight>body.clientHeight){ e.preventDefault(); body.scrollTop += dy; lastY=y; }
    },{passive:false});
    body.addEventListener("touchend",()=>{active=false;},{passive:true});
    body.addEventListener("touchcancel",()=>{active=false;},{passive:true});
  }

  function initKarsaExtensions(){
    karsaExtStyles();
    karsaElegantInteractionStyle();karsaAddNav();karsaMakeOverlay();bindJobModalTouchScroll();
    handleKarsaVerifyQuery();
    const oldOpenJob=openJob;
    openJob=async function(jobId){ oldOpenJob(jobId); const j=state.jobs.find(x=>x.id===jobId); if(j) await loadJobExtras(j); };
    document.addEventListener("keydown",e=>{if(e.key==="Escape")closeKarsaExtension()});
  }

  /*
   * =========================================================
   * BOOT
   * =========================================================
   */

  async function boot() {

    karsaExtStyles();
    karsaAddNav();
    karsaMakeOverlay();
    bind();
    initKarsaExtensions();

    setInterval(
      tick,
      1000
    );

    tick();

    /*
     * Jangan tampilkan login sebelum status session selesai dicek.
     * Sebelumnya loginPage dijadwalkan muncul dengan setTimeout
     * tanpa memperhatikan auto-login. Akibatnya loginPage dapat
     * muncul kembali di atas aplikasi setelah enterApp().
     */
    $("loginPage").classList.add("hidden");
    $("app").classList.add("hidden");

    /*
     * =======================================================
     * SUPABASE SESSION
     * =======================================================
     */

    if (client) {

      const {
        data
      } =
        await client.auth.getSession();

      if (data.session) {

        const {
          data: p
        } =
          await client
            .from("profiles")
            .select("*")
            .eq("id", data.session.user.id)
            .single();

        if (p) {

          state.user = {
            id: data.session.user.id,
            name: p.name,
            email: p.email,
            role: p.role,
            division: p.division,
            initials: initials(p.name),
            title: p.title || roleLabel(p.role),
            employeeId: p.employee_id || "",
            avatarUrl: p.avatar_url || ""
          };

          await enterApp();
        }
      }

      /*
       * AUTH STATE
       */

      client.auth.onAuthStateChange(
        async (event, session) => {

          if (event === "SIGNED_OUT") {

            state.user = null;

            $("app").classList.add("hidden");
            $("loginPage").classList.remove("hidden");

            return;
          }

          if (session && !state.user) {

            const {
              data: p
            } =
              await client
                .from("profiles")
                .select("*")
                .eq("id", session.user.id)
                .single();

            if (p) {

              state.user = {
                id: session.user.id,
                name: p.name,
                email: p.email,
                role: p.role,
                division: p.division,
                initials: initials(p.name),
                title: p.title || roleLabel(p.role),
                employeeId: p.employee_id || "",
                avatarUrl: p.avatar_url || ""
              };

              await enterApp();
            }
          }
        }
      );
    }

    /*
     * Boot screen baru ditutup setelah session selesai dicek.
     * Jika auto-login berhasil, enterApp() sudah menampilkan app.
     * Jika tidak ada session, barulah loginPage ditampilkan.
     */
    $("bootStatus").textContent =
      "Opening secure workspace";

    await new Promise(resolve =>
      setTimeout(resolve, 650)
    );

    $("boot").classList.add("out");

    if (!state.user) {
      $("loginPage").classList.remove("hidden");

      if (CFG.DEMO_MODE) {
        $("demoBox").classList.remove("hidden");
      }
    }
  }

  /*
   * =========================================================
   * START
   * =========================================================
   */

  boot();




})();
