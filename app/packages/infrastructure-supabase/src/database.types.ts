export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  public: {
    Tables: {
      admin_role_grants: {
        Row: {
          granted_at: string
          granted_by: string | null
          id: string
          is_platform: boolean | null
          manager_grant_id: string | null
          revoked_at: string | null
          revoked_by: string | null
          role: string
          scope_org_id: string | null
          user_id: string
        }
        Insert: {
          granted_at?: string
          granted_by?: string | null
          id?: string
          is_platform?: boolean | null
          manager_grant_id?: string | null
          revoked_at?: string | null
          revoked_by?: string | null
          role: string
          scope_org_id?: string | null
          user_id: string
        }
        Update: {
          granted_at?: string
          granted_by?: string | null
          id?: string
          is_platform?: boolean | null
          manager_grant_id?: string | null
          revoked_at?: string | null
          revoked_by?: string | null
          role?: string
          scope_org_id?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "admin_role_grants_granted_by_fkey"
            columns: ["granted_by"]
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "admin_role_grants_manager_grant_id_fkey"
            columns: ["manager_grant_id"]
            referencedRelation: "admin_role_grants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "admin_role_grants_revoked_by_fkey"
            columns: ["revoked_by"]
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "admin_role_grants_scope_org_fk"
            columns: ["scope_org_id"]
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "admin_role_grants_user_id_fkey"
            columns: ["user_id"]
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      app_flags: {
        Row: {
          description: string
          enabled: boolean
          key: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          description?: string
          enabled?: boolean
          key: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          description?: string
          enabled?: boolean
          key?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "app_flags_updated_by_fkey"
            columns: ["updated_by"]
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      blocks: {
        Row: {
          blocked_id: string
          blocker_id: string
          created_at: string
        }
        Insert: {
          blocked_id: string
          blocker_id: string
          created_at?: string
        }
        Update: {
          blocked_id?: string
          blocker_id?: string
          created_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "blocks_blocked_id_fkey"
            columns: ["blocked_id"]
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "blocks_blocker_id_fkey"
            columns: ["blocker_id"]
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      challenge_participations: {
        Row: {
          best_streak: number
          challenge_id: string
          completed_at: string | null
          current_streak: number
          joined_at: string
          last_success_cycle: string | null
          successful_cycles: number
          user_id: string
        }
        Insert: {
          best_streak?: number
          challenge_id: string
          completed_at?: string | null
          current_streak?: number
          joined_at?: string
          last_success_cycle?: string | null
          successful_cycles?: number
          user_id: string
        }
        Update: {
          best_streak?: number
          challenge_id?: string
          completed_at?: string | null
          current_streak?: number
          joined_at?: string
          last_success_cycle?: string | null
          successful_cycles?: number
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "challenge_participations_challenge_id_fkey"
            columns: ["challenge_id"]
            referencedRelation: "challenges"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "challenge_participations_user_id_fkey"
            columns: ["user_id"]
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      challenge_progress_entries: {
        Row: {
          challenge_id: string
          cycle_start: string
          goal_met: boolean
          note: string | null
          reported_at: string
          user_id: string
          value: number
        }
        Insert: {
          challenge_id: string
          cycle_start: string
          goal_met: boolean
          note?: string | null
          reported_at?: string
          user_id: string
          value: number
        }
        Update: {
          challenge_id?: string
          cycle_start?: string
          goal_met?: boolean
          note?: string | null
          reported_at?: string
          user_id?: string
          value?: number
        }
        Relationships: [
          {
            foreignKeyName: "challenge_progress_entries_participation_fk"
            columns: ["challenge_id", "user_id"]
            referencedRelation: "challenge_participations"
            referencedColumns: ["challenge_id", "user_id"]
          },
        ]
      }
      challenges: {
        Row: {
          cadence: string
          created_at: string
          creator_id: string
          difficulty: string | null
          ends_at: string | null
          goal_direction: string | null
          goal_value: number | null
          id: string
          measurement: string
          participants_count: number
          post_id: string
          scope: string
          status: string
          target_cycles: number | null
          topic_label: string | null
          updated_at: string
        }
        Insert: {
          cadence: string
          created_at?: string
          creator_id: string
          difficulty?: string | null
          ends_at?: string | null
          goal_direction?: string | null
          goal_value?: number | null
          id?: string
          measurement: string
          participants_count?: number
          post_id: string
          scope: string
          status?: string
          target_cycles?: number | null
          topic_label?: string | null
          updated_at?: string
        }
        Update: {
          cadence?: string
          created_at?: string
          creator_id?: string
          difficulty?: string | null
          ends_at?: string | null
          goal_direction?: string | null
          goal_value?: number | null
          id?: string
          measurement?: string
          participants_count?: number
          post_id?: string
          scope?: string
          status?: string
          target_cycles?: number | null
          topic_label?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "challenges_creator_id_fkey"
            columns: ["creator_id"]
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "challenges_post_id_fkey"
            columns: ["post_id"]
            referencedRelation: "posts"
            referencedColumns: ["id"]
          },
        ]
      }
      chat_members: {
        Row: {
          chat_id: string
          hidden_at: string | null
          joined_at: string
          last_read_at: string
          role: string
          user_id: string
        }
        Insert: {
          chat_id: string
          hidden_at?: string | null
          joined_at?: string
          last_read_at?: string
          role?: string
          user_id: string
        }
        Update: {
          chat_id?: string
          hidden_at?: string | null
          joined_at?: string
          last_read_at?: string
          role?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "chat_members_chat_id_fkey"
            columns: ["chat_id"]
            referencedRelation: "chats"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "chat_members_user_id_fkey"
            columns: ["user_id"]
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      chats: {
        Row: {
          anchor_post_id: string | null
          created_at: string
          direct_user_a: string | null
          direct_user_b: string | null
          id: string
          kind: string
          last_message_at: string | null
          moderation_hidden_at: string | null
          support_user_id: string | null
        }
        Insert: {
          anchor_post_id?: string | null
          created_at?: string
          direct_user_a?: string | null
          direct_user_b?: string | null
          id?: string
          kind: string
          last_message_at?: string | null
          moderation_hidden_at?: string | null
          support_user_id?: string | null
        }
        Update: {
          anchor_post_id?: string | null
          created_at?: string
          direct_user_a?: string | null
          direct_user_b?: string | null
          id?: string
          kind?: string
          last_message_at?: string | null
          moderation_hidden_at?: string | null
          support_user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "chats_anchor_post_id_fkey"
            columns: ["anchor_post_id"]
            referencedRelation: "posts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "chats_direct_user_a_fkey"
            columns: ["direct_user_a"]
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "chats_direct_user_b_fkey"
            columns: ["direct_user_b"]
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "chats_support_user_id_fkey"
            columns: ["support_user_id"]
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      cities: {
        Row: {
          city_id: string
          country_code: string
          location: unknown
          name_en: string
          name_he: string
        }
        Insert: {
          city_id: string
          country_code?: string
          location?: unknown
          name_en: string
          name_he: string
        }
        Update: {
          city_id?: string
          country_code?: string
          location?: unknown
          name_en?: string
          name_he?: string
        }
        Relationships: []
      }
      content_translations: {
        Row: {
          confidence: number | null
          content_id: string
          content_type: string
          created_at: string
          field: string
          model: string | null
          source_language: string | null
          target_language: string
          translated_text: string
        }
        Insert: {
          confidence?: number | null
          content_id: string
          content_type: string
          created_at?: string
          field: string
          model?: string | null
          source_language?: string | null
          target_language: string
          translated_text: string
        }
        Update: {
          confidence?: number | null
          content_id?: string
          content_type?: string
          created_at?: string
          field?: string
          model?: string | null
          source_language?: string | null
          target_language?: string
          translated_text?: string
        }
        Relationships: []
      }
      donation_link_categories: {
        Row: {
          icon_name: string
          is_active: boolean
          slug: string
          sort_order: number
        }
        Insert: {
          icon_name: string
          is_active?: boolean
          slug: string
          sort_order: number
        }
        Update: {
          icon_name?: string
          is_active?: boolean
          slug?: string
          sort_order?: number
        }
        Relationships: []
      }
      donation_links: {
        Row: {
          category_slug: string
          created_at: string
          description: string | null
          display_name: string
          id: string
          review_note: string | null
          review_status: string
          reviewed_at: string | null
          reviewed_by: string | null
          search_vector: unknown
          submitted_by: string | null
          updated_at: string
          url: string
          validated_at: string
        }
        Insert: {
          category_slug: string
          created_at?: string
          description?: string | null
          display_name: string
          id?: string
          review_note?: string | null
          review_status?: string
          reviewed_at?: string | null
          reviewed_by?: string | null
          search_vector?: unknown
          submitted_by?: string | null
          updated_at?: string
          url: string
          validated_at: string
        }
        Update: {
          category_slug?: string
          created_at?: string
          description?: string | null
          display_name?: string
          id?: string
          review_note?: string | null
          review_status?: string
          reviewed_at?: string | null
          reviewed_by?: string | null
          search_vector?: unknown
          submitted_by?: string | null
          updated_at?: string
          url?: string
          validated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "donation_links_category_slug_fkey"
            columns: ["category_slug"]
            referencedRelation: "donation_link_categories"
            referencedColumns: ["slug"]
          },
          {
            foreignKeyName: "donation_links_reviewed_by_fkey"
            columns: ["reviewed_by"]
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "donation_links_submitted_by_fkey"
            columns: ["submitted_by"]
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      external_bodies: {
        Row: {
          body_type: string
          contact_url: string | null
          created_at: string
          id: string
          is_active: boolean
          is_verified: boolean
          label_en: string
          label_he: string
          requires_routing: boolean
          slug: string
          sort_order: number
          updated_at: string
          world_slug: string
        }
        Insert: {
          body_type: string
          contact_url?: string | null
          created_at?: string
          id?: string
          is_active?: boolean
          is_verified?: boolean
          label_en: string
          label_he: string
          requires_routing?: boolean
          slug: string
          sort_order?: number
          updated_at?: string
          world_slug: string
        }
        Update: {
          body_type?: string
          contact_url?: string | null
          created_at?: string
          id?: string
          is_active?: boolean
          is_verified?: boolean
          label_en?: string
          label_he?: string
          requires_routing?: boolean
          slug?: string
          sort_order?: number
          updated_at?: string
          world_slug?: string
        }
        Relationships: [
          {
            foreignKeyName: "external_bodies_world_slug_fkey"
            columns: ["world_slug"]
            referencedRelation: "worlds"
            referencedColumns: ["slug"]
          },
        ]
      }
      feed_hides: {
        Row: {
          hidden_at: string
          post_id: string
          user_id: string
        }
        Insert: {
          hidden_at?: string
          post_id: string
          user_id: string
        }
        Update: {
          hidden_at?: string
          post_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "feed_hides_post_id_fkey"
            columns: ["post_id"]
            referencedRelation: "posts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "feed_hides_user_id_fkey"
            columns: ["user_id"]
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      feed_impressions: {
        Row: {
          post_id: string
          seen_at: string
          user_id: string
        }
        Insert: {
          post_id: string
          seen_at?: string
          user_id?: string
        }
        Update: {
          post_id?: string
          seen_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "feed_impressions_user_id_fkey"
            columns: ["user_id"]
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      feed_impressions_2026_11: {
        Row: {
          post_id: string
          seen_at: string
          user_id: string
        }
        Insert: {
          post_id: string
          seen_at?: string
          user_id?: string
        }
        Update: {
          post_id?: string
          seen_at?: string
          user_id?: string
        }
        Relationships: []
      }
      feed_impressions_2026_12: {
        Row: {
          post_id: string
          seen_at: string
          user_id: string
        }
        Insert: {
          post_id: string
          seen_at?: string
          user_id?: string
        }
        Update: {
          post_id?: string
          seen_at?: string
          user_id?: string
        }
        Relationships: []
      }
      feed_impressions_default: {
        Row: {
          post_id: string
          seen_at: string
          user_id: string
        }
        Insert: {
          post_id: string
          seen_at?: string
          user_id?: string
        }
        Update: {
          post_id?: string
          seen_at?: string
          user_id?: string
        }
        Relationships: []
      }
      feed_mute_filters: {
        Row: {
          created_at: string
          filter_kind: string
          id: string
          keyword: string | null
          muted_user_id: string | null
          user_id: string
          world_slug: string | null
        }
        Insert: {
          created_at?: string
          filter_kind: string
          id?: string
          keyword?: string | null
          muted_user_id?: string | null
          user_id: string
          world_slug?: string | null
        }
        Update: {
          created_at?: string
          filter_kind?: string
          id?: string
          keyword?: string | null
          muted_user_id?: string | null
          user_id?: string
          world_slug?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "feed_mute_filters_muted_user_id_fkey"
            columns: ["muted_user_id"]
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "feed_mute_filters_user_id_fkey"
            columns: ["user_id"]
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "feed_mute_filters_world_slug_fkey"
            columns: ["world_slug"]
            referencedRelation: "worlds"
            referencedColumns: ["slug"]
          },
        ]
      }
      feed_ranking_config: {
        Row: {
          config_key: string
          updated_at: string
          value: number
        }
        Insert: {
          config_key: string
          updated_at?: string
          value: number
        }
        Update: {
          config_key?: string
          updated_at?: string
          value?: number
        }
        Relationships: []
      }
      follow_requests: {
        Row: {
          cooldown_until: string | null
          created_at: string
          id: string
          requester_id: string
          resolved_at: string | null
          status: string
          target_id: string
        }
        Insert: {
          cooldown_until?: string | null
          created_at?: string
          id?: string
          requester_id: string
          resolved_at?: string | null
          status?: string
          target_id: string
        }
        Update: {
          cooldown_until?: string | null
          created_at?: string
          id?: string
          requester_id?: string
          resolved_at?: string | null
          status?: string
          target_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "follow_requests_requester_id_fkey"
            columns: ["requester_id"]
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "follow_requests_target_id_fkey"
            columns: ["target_id"]
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      follows: {
        Row: {
          created_at: string
          followed_id: string
          follower_id: string
        }
        Insert: {
          created_at?: string
          followed_id: string
          follower_id: string
        }
        Update: {
          created_at?: string
          followed_id?: string
          follower_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "follows_followed_id_fkey"
            columns: ["followed_id"]
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "follows_follower_id_fkey"
            columns: ["follower_id"]
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      handoff_booking_details: {
        Row: {
          adults: number
          cancel_note: string | null
          check_in_date: string
          check_out_date: string
          created_at: string
          decision_note: string | null
          handoff_id: string
          late_cancel: boolean
          message: string
          minors: number
          minors_guardian_ack: boolean
          updated_at: string
        }
        Insert: {
          adults: number
          cancel_note?: string | null
          check_in_date: string
          check_out_date: string
          created_at?: string
          decision_note?: string | null
          handoff_id: string
          late_cancel?: boolean
          message: string
          minors?: number
          minors_guardian_ack?: boolean
          updated_at?: string
        }
        Update: {
          adults?: number
          cancel_note?: string | null
          check_in_date?: string
          check_out_date?: string
          created_at?: string
          decision_note?: string | null
          handoff_id?: string
          late_cancel?: boolean
          message?: string
          minors?: number
          minors_guardian_ack?: boolean
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "handoff_booking_details_handoff_id_fkey"
            columns: ["handoff_id"]
            referencedRelation: "post_handoffs"
            referencedColumns: ["id"]
          },
        ]
      }
      item_subcategories: {
        Row: {
          created_at: string
          id: string
          is_active: boolean
          label_en: string
          label_he: string
          parent_id: string | null
          slug: string
          sort_order: number
          world_slug: string
        }
        Insert: {
          created_at?: string
          id?: string
          is_active?: boolean
          label_en: string
          label_he: string
          parent_id?: string | null
          slug: string
          sort_order?: number
          world_slug: string
        }
        Update: {
          created_at?: string
          id?: string
          is_active?: boolean
          label_en?: string
          label_he?: string
          parent_id?: string | null
          slug?: string
          sort_order?: number
          world_slug?: string
        }
        Relationships: [
          {
            foreignKeyName: "item_subcategories_parent_fk"
            columns: ["parent_id", "world_slug"]
            referencedRelation: "item_subcategories"
            referencedColumns: ["id", "world_slug"]
          },
          {
            foreignKeyName: "item_subcategories_world_slug_fkey"
            columns: ["world_slug"]
            referencedRelation: "worlds"
            referencedColumns: ["slug"]
          },
        ]
      }
      karma_ledger: {
        Row: {
          created_at: string
          event_type: string
          id: number
          points: number
          reference: string
          subject: string
          user_id: string
        }
        Insert: {
          created_at?: string
          event_type: string
          id?: never
          points: number
          reference: string
          subject: string
          user_id: string
        }
        Update: {
          created_at?: string
          event_type?: string
          id?: never
          points?: number
          reference?: string
          subject?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "karma_ledger_user_id_fkey"
            columns: ["user_id"]
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      knowledge_topic_aliases: {
        Row: {
          alias: string
          alias_norm: string | null
          created_at: string
          id: string
          lang: string
          topic_id: string
        }
        Insert: {
          alias: string
          alias_norm?: string | null
          created_at?: string
          id?: string
          lang?: string
          topic_id: string
        }
        Update: {
          alias?: string
          alias_norm?: string | null
          created_at?: string
          id?: string
          lang?: string
          topic_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "knowledge_topic_aliases_topic_id_fkey"
            columns: ["topic_id"]
            referencedRelation: "knowledge_topics"
            referencedColumns: ["id"]
          },
        ]
      }
      knowledge_topics: {
        Row: {
          created_at: string
          description_he: string | null
          id: string
          label_en: string
          label_he: string
          merged_into_id: string | null
          parent_id: string | null
          slug: string
          sort_order: number
          status: string
          updated_at: string
          world_slug: string
        }
        Insert: {
          created_at?: string
          description_he?: string | null
          id?: string
          label_en: string
          label_he: string
          merged_into_id?: string | null
          parent_id?: string | null
          slug: string
          sort_order?: number
          status?: string
          updated_at?: string
          world_slug: string
        }
        Update: {
          created_at?: string
          description_he?: string | null
          id?: string
          label_en?: string
          label_he?: string
          merged_into_id?: string | null
          parent_id?: string | null
          slug?: string
          sort_order?: number
          status?: string
          updated_at?: string
          world_slug?: string
        }
        Relationships: [
          {
            foreignKeyName: "knowledge_topics_merged_into_id_fkey"
            columns: ["merged_into_id"]
            referencedRelation: "knowledge_topics"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "knowledge_topics_parent_id_fkey"
            columns: ["parent_id"]
            referencedRelation: "knowledge_topics"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "knowledge_topics_world_slug_fkey"
            columns: ["world_slug"]
            referencedRelation: "worlds"
            referencedColumns: ["slug"]
          },
        ]
      }
      legal_document_versions: {
        Row: {
          body_md: string
          change_summary: string | null
          content_hash: string
          doc_type: string
          effective_date: string
          id: string
          language: string
          published_at: string
          published_by: string | null
          severity: string
          version: number
        }
        Insert: {
          body_md: string
          change_summary?: string | null
          content_hash: string
          doc_type: string
          effective_date: string
          id?: string
          language?: string
          published_at?: string
          published_by?: string | null
          severity: string
          version: number
        }
        Update: {
          body_md?: string
          change_summary?: string | null
          content_hash?: string
          doc_type?: string
          effective_date?: string
          id?: string
          language?: string
          published_at?: string
          published_by?: string | null
          severity?: string
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "legal_document_versions_doc_type_fkey"
            columns: ["doc_type"]
            referencedRelation: "legal_documents"
            referencedColumns: ["doc_type"]
          },
          {
            foreignKeyName: "legal_document_versions_published_by_fkey"
            columns: ["published_by"]
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      legal_documents: {
        Row: {
          current_effective_date: string
          current_version: number
          doc_type: string
          id: string
          last_material_severity: string | null
          last_material_version: number
          updated_at: string
        }
        Insert: {
          current_effective_date: string
          current_version?: number
          doc_type: string
          id?: string
          last_material_severity?: string | null
          last_material_version?: number
          updated_at?: string
        }
        Update: {
          current_effective_date?: string
          current_version?: number
          doc_type?: string
          id?: string
          last_material_severity?: string | null
          last_material_version?: number
          updated_at?: string
        }
        Relationships: []
      }
      message_reactions: {
        Row: {
          created_at: string
          message_id: string
          reaction_type: string
          user_id: string
        }
        Insert: {
          created_at?: string
          message_id: string
          reaction_type: string
          user_id: string
        }
        Update: {
          created_at?: string
          message_id?: string
          reaction_type?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "message_reactions_message_id_fkey"
            columns: ["message_id"]
            referencedRelation: "messages"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "message_reactions_user_id_fkey"
            columns: ["user_id"]
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      messages: {
        Row: {
          body: string | null
          chat_id: string
          created_at: string
          id: string
          kind: string
          media_payload: Json | null
          sender_id: string | null
          source_language: string | null
          system_payload: Json | null
        }
        Insert: {
          body?: string | null
          chat_id: string
          created_at?: string
          id?: string
          kind?: string
          media_payload?: Json | null
          sender_id?: string | null
          source_language?: string | null
          system_payload?: Json | null
        }
        Update: {
          body?: string | null
          chat_id?: string
          created_at?: string
          id?: string
          kind?: string
          media_payload?: Json | null
          sender_id?: string | null
          source_language?: string | null
          system_payload?: Json | null
        }
        Relationships: [
          {
            foreignKeyName: "messages_chat_id_fkey"
            columns: ["chat_id"]
            referencedRelation: "chats"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "messages_sender_id_fkey"
            columns: ["sender_id"]
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      moderation_queue: {
        Row: {
          assignee_id: string | null
          created_at: string
          id: string
          metadata: Json
          reason: string
          resolved_at: string | null
          resolved_by: string | null
          status: string
          target_id: string
          target_type: string
        }
        Insert: {
          assignee_id?: string | null
          created_at?: string
          id?: string
          metadata?: Json
          reason: string
          resolved_at?: string | null
          resolved_by?: string | null
          status?: string
          target_id: string
          target_type: string
        }
        Update: {
          assignee_id?: string | null
          created_at?: string
          id?: string
          metadata?: Json
          reason?: string
          resolved_at?: string | null
          resolved_by?: string | null
          status?: string
          target_id?: string
          target_type?: string
        }
        Relationships: [
          {
            foreignKeyName: "moderation_queue_assignee_id_fkey"
            columns: ["assignee_id"]
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "moderation_queue_resolved_by_fkey"
            columns: ["resolved_by"]
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      notifications: {
        Row: {
          actor_ids: string[]
          body_key: string
          category: string
          created_at: string
          data: Json
          entity_id: string | null
          entity_type: string | null
          group_count: number
          group_key: string | null
          id: string
          kind: string
          read_at: string | null
          title_key: string
          updated_at: string
          user_id: string
          world_slug: string | null
        }
        Insert: {
          actor_ids?: string[]
          body_key: string
          category: string
          created_at?: string
          data?: Json
          entity_id?: string | null
          entity_type?: string | null
          group_count?: number
          group_key?: string | null
          id?: string
          kind: string
          read_at?: string | null
          title_key: string
          updated_at?: string
          user_id: string
          world_slug?: string | null
        }
        Update: {
          actor_ids?: string[]
          body_key?: string
          category?: string
          created_at?: string
          data?: Json
          entity_id?: string | null
          entity_type?: string | null
          group_count?: number
          group_key?: string | null
          id?: string
          kind?: string
          read_at?: string | null
          title_key?: string
          updated_at?: string
          user_id?: string
          world_slug?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "notifications_user_id_fkey"
            columns: ["user_id"]
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      org_applications: {
        Row: {
          applicant_id: string
          contact_email: string | null
          contact_phone: string | null
          created_at: string
          declared_nonprofit: boolean
          id: string
          org_description: string | null
          org_name: string
          org_type: string | null
          organization_id: string | null
          registration_number: string | null
          review_note: string | null
          reviewed_at: string | null
          reviewed_by: string | null
          status: string
          website_url: string | null
        }
        Insert: {
          applicant_id: string
          contact_email?: string | null
          contact_phone?: string | null
          created_at?: string
          declared_nonprofit: boolean
          id?: string
          org_description?: string | null
          org_name: string
          org_type?: string | null
          organization_id?: string | null
          registration_number?: string | null
          review_note?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          status?: string
          website_url?: string | null
        }
        Update: {
          applicant_id?: string
          contact_email?: string | null
          contact_phone?: string | null
          created_at?: string
          declared_nonprofit?: boolean
          id?: string
          org_description?: string | null
          org_name?: string
          org_type?: string | null
          organization_id?: string | null
          registration_number?: string | null
          review_note?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          status?: string
          website_url?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "org_applications_applicant_id_fkey"
            columns: ["applicant_id"]
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "org_applications_organization_id_fkey"
            columns: ["organization_id"]
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "org_applications_reviewed_by_fkey"
            columns: ["reviewed_by"]
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      org_memberships: {
        Row: {
          can_post: boolean
          joined_at: string
          org_id: string
          roles: string[]
          updated_at: string
          user_id: string
        }
        Insert: {
          can_post?: boolean
          joined_at?: string
          org_id: string
          roles: string[]
          updated_at?: string
          user_id: string
        }
        Update: {
          can_post?: boolean
          joined_at?: string
          org_id?: string
          roles?: string[]
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "org_memberships_org_id_fkey"
            columns: ["org_id"]
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "org_memberships_user_id_fkey"
            columns: ["user_id"]
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      organizations: {
        Row: {
          city_id: string | null
          contact_email: string | null
          created_at: string
          id: string
          is_platform: boolean
          is_verified_nonprofit: boolean
          name: string
          org_type: string | null
          public_about_en: string | null
          public_about_he: string | null
          public_tagline_en: string | null
          public_tagline_he: string | null
          registration_number: string | null
          sec46_approval_number: string | null
          sec46_status: string
          sec46_valid_from: string | null
          sec46_valid_until: string | null
          show_category_breakdown: boolean
          show_donations_count: boolean
          show_monthly_trend: boolean
          show_program_ratio: boolean
          show_totals: boolean
          slug: string
          status: string
          updated_at: string
          verification_level: number
          verification_method: string | null
          verified_at: string | null
          verified_by: string | null
          website_url: string | null
        }
        Insert: {
          city_id?: string | null
          contact_email?: string | null
          created_at?: string
          id?: string
          is_platform?: boolean
          is_verified_nonprofit?: boolean
          name: string
          org_type?: string | null
          public_about_en?: string | null
          public_about_he?: string | null
          public_tagline_en?: string | null
          public_tagline_he?: string | null
          registration_number?: string | null
          sec46_approval_number?: string | null
          sec46_status?: string
          sec46_valid_from?: string | null
          sec46_valid_until?: string | null
          show_category_breakdown?: boolean
          show_donations_count?: boolean
          show_monthly_trend?: boolean
          show_program_ratio?: boolean
          show_totals?: boolean
          slug: string
          status?: string
          updated_at?: string
          verification_level?: number
          verification_method?: string | null
          verified_at?: string | null
          verified_by?: string | null
          website_url?: string | null
        }
        Update: {
          city_id?: string | null
          contact_email?: string | null
          created_at?: string
          id?: string
          is_platform?: boolean
          is_verified_nonprofit?: boolean
          name?: string
          org_type?: string | null
          public_about_en?: string | null
          public_about_he?: string | null
          public_tagline_en?: string | null
          public_tagline_he?: string | null
          registration_number?: string | null
          sec46_approval_number?: string | null
          sec46_status?: string
          sec46_valid_from?: string | null
          sec46_valid_until?: string | null
          show_category_breakdown?: boolean
          show_donations_count?: boolean
          show_monthly_trend?: boolean
          show_program_ratio?: boolean
          show_totals?: boolean
          slug?: string
          status?: string
          updated_at?: string
          verification_level?: number
          verification_method?: string | null
          verified_at?: string | null
          verified_by?: string | null
          website_url?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "organizations_city_id_fkey"
            columns: ["city_id"]
            referencedRelation: "cities"
            referencedColumns: ["city_id"]
          },
          {
            foreignKeyName: "organizations_verified_by_fkey"
            columns: ["verified_by"]
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      post_actor_identity: {
        Row: {
          created_at: string
          hide_from_counterparty: boolean
          identity_visibility: string | null
          post_id: string
          surface_visibility: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          hide_from_counterparty?: boolean
          identity_visibility?: string | null
          post_id: string
          surface_visibility?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          hide_from_counterparty?: boolean
          identity_visibility?: string | null
          post_id?: string
          surface_visibility?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "post_actor_identity_post_id_fkey"
            columns: ["post_id"]
            referencedRelation: "posts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "post_actor_identity_user_id_fkey"
            columns: ["user_id"]
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      post_closures: {
        Row: {
          delivered: boolean
          post_id: string
          purge_after: string | null
          reopen_count: number
          updated_at: string
        }
        Insert: {
          delivered?: boolean
          post_id: string
          purge_after?: string | null
          reopen_count?: number
          updated_at?: string
        }
        Update: {
          delivered?: boolean
          post_id?: string
          purge_after?: string | null
          reopen_count?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "post_closures_post_id_fkey"
            columns: ["post_id"]
            referencedRelation: "posts"
            referencedColumns: ["id"]
          },
        ]
      }
      post_comment_reactions: {
        Row: {
          comment_id: string
          created_at: string
          user_id: string
        }
        Insert: {
          comment_id: string
          created_at?: string
          user_id: string
        }
        Update: {
          comment_id?: string
          created_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "post_comment_reactions_comment_id_fkey"
            columns: ["comment_id"]
            referencedRelation: "post_comments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "post_comment_reactions_user_id_fkey"
            columns: ["user_id"]
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      post_comments: {
        Row: {
          author_id: string
          body: string
          created_at: string
          edited_at: string | null
          id: string
          mention_user_ids: string[]
          parent_comment_id: string | null
          post_id: string
          status: string
          updated_at: string
        }
        Insert: {
          author_id: string
          body: string
          created_at?: string
          edited_at?: string | null
          id?: string
          mention_user_ids?: string[]
          parent_comment_id?: string | null
          post_id: string
          status?: string
          updated_at?: string
        }
        Update: {
          author_id?: string
          body?: string
          created_at?: string
          edited_at?: string | null
          id?: string
          mention_user_ids?: string[]
          parent_comment_id?: string | null
          post_id?: string
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "post_comments_author_id_fkey"
            columns: ["author_id"]
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "post_comments_parent_comment_id_fkey"
            columns: ["parent_comment_id"]
            referencedRelation: "post_comments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "post_comments_post_id_fkey"
            columns: ["post_id"]
            referencedRelation: "posts"
            referencedColumns: ["id"]
          },
        ]
      }
      post_embeddings: {
        Row: {
          embedding: string
          embedding_model: string
          post_id: string
          updated_at: string
        }
        Insert: {
          embedding: string
          embedding_model: string
          post_id: string
          updated_at?: string
        }
        Update: {
          embedding?: string
          embedding_model?: string
          post_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "post_embeddings_post_id_fkey"
            columns: ["post_id"]
            referencedRelation: "posts"
            referencedColumns: ["id"]
          },
        ]
      }
      post_emergencies: {
        Row: {
          created_at: string
          id: string
          location: unknown
          note: string | null
          post_id: string
          reporter_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          location?: unknown
          note?: string | null
          post_id: string
          reporter_id: string
        }
        Update: {
          created_at?: string
          id?: string
          location?: unknown
          note?: string | null
          post_id?: string
          reporter_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "post_emergencies_post_id_fkey"
            columns: ["post_id"]
            referencedRelation: "posts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "post_emergencies_reporter_id_fkey"
            columns: ["reporter_id"]
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      post_event_details: {
        Row: {
          address_label: string | null
          capacity: number | null
          counts_volunteer_hours: boolean
          created_at: string
          ends_at: string
          post_id: string
          registration_policy: string
          series_id: string | null
          series_on: string | null
          starts_at: string
          updated_at: string
        }
        Insert: {
          address_label?: string | null
          capacity?: number | null
          counts_volunteer_hours?: boolean
          created_at?: string
          ends_at: string
          post_id: string
          registration_policy?: string
          series_id?: string | null
          series_on?: string | null
          starts_at: string
          updated_at?: string
        }
        Update: {
          address_label?: string | null
          capacity?: number | null
          counts_volunteer_hours?: boolean
          created_at?: string
          ends_at?: string
          post_id?: string
          registration_policy?: string
          series_id?: string | null
          series_on?: string | null
          starts_at?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "post_event_details_post_id_fkey"
            columns: ["post_id"]
            referencedRelation: "posts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "post_event_details_series_id_fkey"
            columns: ["series_id"]
            referencedRelation: "post_series"
            referencedColumns: ["id"]
          },
        ]
      }
      post_food_details: {
        Row: {
          allergens: string[]
          created_at: string
          dietary_tags: string[]
          expires_at: string
          expiry_alerted_at: string | null
          food_type: string | null
          kosher: boolean | null
          post_id: string
          updated_at: string
        }
        Insert: {
          allergens?: string[]
          created_at?: string
          dietary_tags?: string[]
          expires_at: string
          expiry_alerted_at?: string | null
          food_type?: string | null
          kosher?: boolean | null
          post_id: string
          updated_at?: string
        }
        Update: {
          allergens?: string[]
          created_at?: string
          dietary_tags?: string[]
          expires_at?: string
          expiry_alerted_at?: string | null
          food_type?: string | null
          kosher?: boolean | null
          post_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "post_food_details_post_id_fkey"
            columns: ["post_id"]
            referencedRelation: "posts"
            referencedColumns: ["id"]
          },
        ]
      }
      post_handoffs: {
        Row: {
          cancel_reason: string | null
          cancelled_at: string | null
          confirm_by: string | null
          confirmed_at: string | null
          created_at: string
          handed_over_at: string | null
          id: string
          machine_id: string
          no_show_at: string | null
          owner_id: string
          pickup_mode: string
          pickup_window_end: string | null
          pickup_window_start: string | null
          post_id: string
          recipient_id: string
          requested_meeting_point: Json | null
          seats: number
          slot_ends_at: string | null
          slot_starts_at: string | null
          status: string
          updated_at: string
        }
        Insert: {
          cancel_reason?: string | null
          cancelled_at?: string | null
          confirm_by?: string | null
          confirmed_at?: string | null
          created_at?: string
          handed_over_at?: string | null
          id?: string
          machine_id: string
          no_show_at?: string | null
          owner_id: string
          pickup_mode?: string
          pickup_window_end?: string | null
          pickup_window_start?: string | null
          post_id: string
          recipient_id: string
          requested_meeting_point?: Json | null
          seats?: number
          slot_ends_at?: string | null
          slot_starts_at?: string | null
          status?: string
          updated_at?: string
        }
        Update: {
          cancel_reason?: string | null
          cancelled_at?: string | null
          confirm_by?: string | null
          confirmed_at?: string | null
          created_at?: string
          handed_over_at?: string | null
          id?: string
          machine_id?: string
          no_show_at?: string | null
          owner_id?: string
          pickup_mode?: string
          pickup_window_end?: string | null
          pickup_window_start?: string | null
          post_id?: string
          recipient_id?: string
          requested_meeting_point?: Json | null
          seats?: number
          slot_ends_at?: string | null
          slot_starts_at?: string | null
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "post_handoffs_owner_id_fkey"
            columns: ["owner_id"]
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "post_handoffs_post_id_fkey"
            columns: ["post_id"]
            referencedRelation: "posts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "post_handoffs_recipient_id_fkey"
            columns: ["recipient_id"]
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      post_housing_details: {
        Row: {
          available_from: string | null
          available_until: string | null
          available_weekdays: number | null
          blackout_dates: string[]
          capacity: number
          check_in_from: string
          check_in_until: string
          check_out_by: string
          children_ok: boolean
          created_at: string
          exclusive: boolean
          max_nights: number
          min_nights: number
          pets_ok: boolean
          place_type: string
          post_id: string
          updated_at: string
        }
        Insert: {
          available_from?: string | null
          available_until?: string | null
          available_weekdays?: number | null
          blackout_dates?: string[]
          capacity: number
          check_in_from?: string
          check_in_until?: string
          check_out_by?: string
          children_ok?: boolean
          created_at?: string
          exclusive?: boolean
          max_nights?: number
          min_nights?: number
          pets_ok?: boolean
          place_type: string
          post_id: string
          updated_at?: string
        }
        Update: {
          available_from?: string | null
          available_until?: string | null
          available_weekdays?: number | null
          blackout_dates?: string[]
          capacity?: number
          check_in_from?: string
          check_in_until?: string
          check_out_by?: string
          children_ok?: boolean
          created_at?: string
          exclusive?: boolean
          max_nights?: number
          min_nights?: number
          pets_ok?: boolean
          place_type?: string
          post_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "post_housing_details_post_id_fkey"
            columns: ["post_id"]
            referencedRelation: "posts"
            referencedColumns: ["id"]
          },
        ]
      }
      post_kinds: {
        Row: {
          created_at: string
          default_ttl_hours: number | null
          detail_schema: Json
          direction: string
          id: string
          is_active: boolean
          label_en: string
          label_he: string
          slug: string
          sort_order: number
          world_slug: string
        }
        Insert: {
          created_at?: string
          default_ttl_hours?: number | null
          detail_schema?: Json
          direction: string
          id?: string
          is_active?: boolean
          label_en: string
          label_he: string
          slug: string
          sort_order?: number
          world_slug: string
        }
        Update: {
          created_at?: string
          default_ttl_hours?: number | null
          detail_schema?: Json
          direction?: string
          id?: string
          is_active?: boolean
          label_en?: string
          label_he?: string
          slug?: string
          sort_order?: number
          world_slug?: string
        }
        Relationships: [
          {
            foreignKeyName: "post_kinds_world_slug_fkey"
            columns: ["world_slug"]
            referencedRelation: "worlds"
            referencedColumns: ["slug"]
          },
        ]
      }
      post_knowledge_slots: {
        Row: {
          capacity: number
          created_at: string
          ends_at: string
          id: string
          post_id: string
          starts_at: string
        }
        Insert: {
          capacity?: number
          created_at?: string
          ends_at: string
          id?: string
          post_id: string
          starts_at: string
        }
        Update: {
          capacity?: number
          created_at?: string
          ends_at?: string
          id?: string
          post_id?: string
          starts_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "post_knowledge_slots_post_id_fkey"
            columns: ["post_id"]
            referencedRelation: "posts"
            referencedColumns: ["id"]
          },
        ]
      }
      post_media: {
        Row: {
          blurhash: string | null
          created_at: string
          duration_ms: number | null
          height: number | null
          id: string
          kind: string
          mime_type: string
          ordinal: number
          owner_id: string
          post_id: string
          processing_status: string
          size_bytes: number
          storage_bucket: string
          storage_key: string
          width: number | null
        }
        Insert: {
          blurhash?: string | null
          created_at?: string
          duration_ms?: number | null
          height?: number | null
          id?: string
          kind?: string
          mime_type: string
          ordinal: number
          owner_id: string
          post_id: string
          processing_status?: string
          size_bytes: number
          storage_bucket?: string
          storage_key: string
          width?: number | null
        }
        Update: {
          blurhash?: string | null
          created_at?: string
          duration_ms?: number | null
          height?: number | null
          id?: string
          kind?: string
          mime_type?: string
          ordinal?: number
          owner_id?: string
          post_id?: string
          processing_status?: string
          size_bytes?: number
          storage_bucket?: string
          storage_key?: string
          width?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "post_media_owner_id_fkey"
            columns: ["owner_id"]
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "post_media_post_id_fkey"
            columns: ["post_id"]
            referencedRelation: "posts"
            referencedColumns: ["id"]
          },
        ]
      }
      post_private_locations: {
        Row: {
          access_notes: string | null
          destination_street_number: string | null
          exact_point: unknown
          post_id: string
          street: string | null
          street_number: string | null
          updated_at: string
        }
        Insert: {
          access_notes?: string | null
          destination_street_number?: string | null
          exact_point?: unknown
          post_id: string
          street?: string | null
          street_number?: string | null
          updated_at?: string
        }
        Update: {
          access_notes?: string | null
          destination_street_number?: string | null
          exact_point?: unknown
          post_id?: string
          street?: string | null
          street_number?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "post_private_locations_post_id_fkey"
            columns: ["post_id"]
            referencedRelation: "posts"
            referencedColumns: ["id"]
          },
        ]
      }
      post_ratings: {
        Row: {
          comment: string | null
          created_at: string
          handoff_id: string | null
          id: string
          ratee_id: string
          rater_id: string | null
          stars: number
        }
        Insert: {
          comment?: string | null
          created_at?: string
          handoff_id?: string | null
          id?: string
          ratee_id: string
          rater_id?: string | null
          stars: number
        }
        Update: {
          comment?: string | null
          created_at?: string
          handoff_id?: string | null
          id?: string
          ratee_id?: string
          rater_id?: string | null
          stars?: number
        }
        Relationships: [
          {
            foreignKeyName: "post_ratings_handoff_id_fkey"
            columns: ["handoff_id"]
            referencedRelation: "post_handoffs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "post_ratings_ratee_id_fkey"
            columns: ["ratee_id"]
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "post_ratings_rater_id_fkey"
            columns: ["rater_id"]
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      post_reactions: {
        Row: {
          created_at: string
          post_id: string
          reaction_type: string
          user_id: string
        }
        Insert: {
          created_at?: string
          post_id: string
          reaction_type?: string
          user_id: string
        }
        Update: {
          created_at?: string
          post_id?: string
          reaction_type?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "post_reactions_post_id_fkey"
            columns: ["post_id"]
            referencedRelation: "posts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "post_reactions_user_id_fkey"
            columns: ["user_id"]
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      post_ride_details: {
        Row: {
          arrives_at: string | null
          cargo_food: boolean
          cargo_items: boolean
          cost_share_ils: number | null
          created_at: string
          departs_at: string
          dest_city_id: string | null
          dest_junction_id: number | null
          dest_point: unknown
          dest_street_id: number | null
          luggage: boolean
          meeting_points: Json
          notes: string | null
          origin_city_id: string | null
          origin_junction_id: number | null
          origin_point: unknown
          origin_street_id: number | null
          post_id: string
          reward_model: string
          seats: number
          series_id: string | null
          series_on: string | null
          updated_at: string
        }
        Insert: {
          arrives_at?: string | null
          cargo_food?: boolean
          cargo_items?: boolean
          cost_share_ils?: number | null
          created_at?: string
          departs_at: string
          dest_city_id?: string | null
          dest_junction_id?: number | null
          dest_point: unknown
          dest_street_id?: number | null
          luggage?: boolean
          meeting_points?: Json
          notes?: string | null
          origin_city_id?: string | null
          origin_junction_id?: number | null
          origin_point: unknown
          origin_street_id?: number | null
          post_id: string
          reward_model?: string
          seats?: number
          series_id?: string | null
          series_on?: string | null
          updated_at?: string
        }
        Update: {
          arrives_at?: string | null
          cargo_food?: boolean
          cargo_items?: boolean
          cost_share_ils?: number | null
          created_at?: string
          departs_at?: string
          dest_city_id?: string | null
          dest_junction_id?: number | null
          dest_point?: unknown
          dest_street_id?: number | null
          luggage?: boolean
          meeting_points?: Json
          notes?: string | null
          origin_city_id?: string | null
          origin_junction_id?: number | null
          origin_point?: unknown
          origin_street_id?: number | null
          post_id?: string
          reward_model?: string
          seats?: number
          series_id?: string | null
          series_on?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "post_ride_details_dest_city_id_fkey"
            columns: ["dest_city_id"]
            referencedRelation: "cities"
            referencedColumns: ["city_id"]
          },
          {
            foreignKeyName: "post_ride_details_dest_fk"
            columns: ["dest_city_id", "dest_street_id"]
            referencedRelation: "streets"
            referencedColumns: ["city_id", "street_id"]
          },
          {
            foreignKeyName: "post_ride_details_dest_junction_id_fkey"
            columns: ["dest_junction_id"]
            referencedRelation: "road_junctions"
            referencedColumns: ["junction_id"]
          },
          {
            foreignKeyName: "post_ride_details_origin_city_id_fkey"
            columns: ["origin_city_id"]
            referencedRelation: "cities"
            referencedColumns: ["city_id"]
          },
          {
            foreignKeyName: "post_ride_details_origin_fk"
            columns: ["origin_city_id", "origin_street_id"]
            referencedRelation: "streets"
            referencedColumns: ["city_id", "street_id"]
          },
          {
            foreignKeyName: "post_ride_details_origin_junction_id_fkey"
            columns: ["origin_junction_id"]
            referencedRelation: "road_junctions"
            referencedColumns: ["junction_id"]
          },
          {
            foreignKeyName: "post_ride_details_post_id_fkey"
            columns: ["post_id"]
            referencedRelation: "posts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "post_ride_details_series_id_fkey"
            columns: ["series_id"]
            referencedRelation: "ride_series"
            referencedColumns: ["id"]
          },
        ]
      }
      post_series: {
        Row: {
          beneficiary_org_id: string | null
          created_at: string
          duration_minutes: number
          ends_on: string | null
          event_template: Json
          id: string
          owner_id: string
          post_template: Json
          start_time: string
          starts_on: string
          status: string
          time_zone: string
          updated_at: string
          weekdays: number
        }
        Insert: {
          beneficiary_org_id?: string | null
          created_at?: string
          duration_minutes: number
          ends_on?: string | null
          event_template: Json
          id?: string
          owner_id: string
          post_template: Json
          start_time: string
          starts_on?: string
          status?: string
          time_zone?: string
          updated_at?: string
          weekdays: number
        }
        Update: {
          beneficiary_org_id?: string | null
          created_at?: string
          duration_minutes?: number
          ends_on?: string | null
          event_template?: Json
          id?: string
          owner_id?: string
          post_template?: Json
          start_time?: string
          starts_on?: string
          status?: string
          time_zone?: string
          updated_at?: string
          weekdays?: number
        }
        Relationships: [
          {
            foreignKeyName: "post_series_beneficiary_org_id_fkey"
            columns: ["beneficiary_org_id"]
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "post_series_owner_id_fkey"
            columns: ["owner_id"]
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      post_shares: {
        Row: {
          created_at: string
          external_channel: string | null
          id: string
          post_id: string
          share_kind: string
          user_id: string
        }
        Insert: {
          created_at?: string
          external_channel?: string | null
          id?: string
          post_id: string
          share_kind: string
          user_id: string
        }
        Update: {
          created_at?: string
          external_channel?: string | null
          id?: string
          post_id?: string
          share_kind?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "post_shares_post_id_fkey"
            columns: ["post_id"]
            referencedRelation: "posts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "post_shares_user_id_fkey"
            columns: ["user_id"]
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      post_stats: {
        Row: {
          comments_count: number
          post_id: string
          reactions_count: number
          shares_count: number
          updated_at: string
        }
        Insert: {
          comments_count?: number
          post_id: string
          reactions_count?: number
          shares_count?: number
          updated_at?: string
        }
        Update: {
          comments_count?: number
          post_id?: string
          reactions_count?: number
          shares_count?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "post_stats_post_id_fkey"
            columns: ["post_id"]
            referencedRelation: "posts"
            referencedColumns: ["id"]
          },
        ]
      }
      posts: {
        Row: {
          beneficiary_org_id: string | null
          city_id: string
          created_at: string
          description: string | null
          details: Json
          direction: string
          expires_at: string | null
          feed_folded: boolean
          geo_approx: unknown
          id: string
          item_subcategory_id: string | null
          kind_id: string
          location_display_level: string
          owner_id: string
          post_type: string
          published_at: string | null
          search_vector: unknown
          source: string
          source_language: string | null
          status: string
          status_before_removal: string | null
          time_window: unknown
          title: string
          updated_at: string
          urgency_level: number | null
          visibility: string
          world_slug: string
        }
        Insert: {
          beneficiary_org_id?: string | null
          city_id: string
          created_at?: string
          description?: string | null
          details?: Json
          direction: string
          expires_at?: string | null
          feed_folded?: boolean
          geo_approx?: unknown
          id?: string
          item_subcategory_id?: string | null
          kind_id: string
          location_display_level?: string
          owner_id: string
          post_type?: string
          published_at?: string | null
          search_vector?: unknown
          source?: string
          source_language?: string | null
          status?: string
          status_before_removal?: string | null
          time_window?: unknown
          title: string
          updated_at?: string
          urgency_level?: number | null
          visibility?: string
          world_slug: string
        }
        Update: {
          beneficiary_org_id?: string | null
          city_id?: string
          created_at?: string
          description?: string | null
          details?: Json
          direction?: string
          expires_at?: string | null
          feed_folded?: boolean
          geo_approx?: unknown
          id?: string
          item_subcategory_id?: string | null
          kind_id?: string
          location_display_level?: string
          owner_id?: string
          post_type?: string
          published_at?: string | null
          search_vector?: unknown
          source?: string
          source_language?: string | null
          status?: string
          status_before_removal?: string | null
          time_window?: unknown
          title?: string
          updated_at?: string
          urgency_level?: number | null
          visibility?: string
          world_slug?: string
        }
        Relationships: [
          {
            foreignKeyName: "posts_beneficiary_org_fk"
            columns: ["beneficiary_org_id"]
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "posts_city_id_fkey"
            columns: ["city_id"]
            referencedRelation: "cities"
            referencedColumns: ["city_id"]
          },
          {
            foreignKeyName: "posts_item_subcategory_fk"
            columns: ["item_subcategory_id", "world_slug"]
            referencedRelation: "item_subcategories"
            referencedColumns: ["id", "world_slug"]
          },
          {
            foreignKeyName: "posts_kind_fk"
            columns: ["kind_id", "world_slug"]
            referencedRelation: "post_kinds"
            referencedColumns: ["id", "world_slug"]
          },
          {
            foreignKeyName: "posts_owner_id_fkey"
            columns: ["owner_id"]
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "posts_world_slug_fkey"
            columns: ["world_slug"]
            referencedRelation: "worlds"
            referencedColumns: ["slug"]
          },
        ]
      }
      report_hides: {
        Row: {
          created_at: string
          reporter_id: string
          target_id: string
          target_type: string
        }
        Insert: {
          created_at?: string
          reporter_id: string
          target_id: string
          target_type: string
        }
        Update: {
          created_at?: string
          reporter_id?: string
          target_id?: string
          target_type?: string
        }
        Relationships: [
          {
            foreignKeyName: "report_hides_reporter_id_fkey"
            columns: ["reporter_id"]
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      reports: {
        Row: {
          created_at: string
          id: string
          note: string | null
          reason: string
          reporter_id: string | null
          resolved_at: string | null
          resolved_by: string | null
          sanction_consumed_at: string | null
          status: string
          target_id: string
          target_type: string
        }
        Insert: {
          created_at?: string
          id?: string
          note?: string | null
          reason: string
          reporter_id?: string | null
          resolved_at?: string | null
          resolved_by?: string | null
          sanction_consumed_at?: string | null
          status?: string
          target_id: string
          target_type: string
        }
        Update: {
          created_at?: string
          id?: string
          note?: string | null
          reason?: string
          reporter_id?: string | null
          resolved_at?: string | null
          resolved_by?: string | null
          sanction_consumed_at?: string | null
          status?: string
          target_id?: string
          target_type?: string
        }
        Relationships: [
          {
            foreignKeyName: "reports_reporter_id_fkey"
            columns: ["reporter_id"]
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reports_resolved_by_fkey"
            columns: ["resolved_by"]
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      ride_route_alerts: {
        Row: {
          created_at: string
          post_id: string
          route_id: string
          series_id: string | null
          user_id: string
        }
        Insert: {
          created_at?: string
          post_id: string
          route_id: string
          series_id?: string | null
          user_id: string
        }
        Update: {
          created_at?: string
          post_id?: string
          route_id?: string
          series_id?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "ride_route_alerts_post_id_fkey"
            columns: ["post_id"]
            referencedRelation: "posts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ride_route_alerts_route_id_fkey"
            columns: ["route_id"]
            referencedRelation: "ride_saved_routes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ride_route_alerts_series_id_fkey"
            columns: ["series_id"]
            referencedRelation: "ride_series"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ride_route_alerts_user_id_fkey"
            columns: ["user_id"]
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      ride_saved_routes: {
        Row: {
          created_at: string
          dest_city_id: string | null
          dest_junction_id: number | null
          dest_point: unknown
          dest_street_id: number | null
          id: string
          origin_city_id: string | null
          origin_junction_id: number | null
          origin_point: unknown
          origin_street_id: number | null
          radius_km: number
          time_from: string | null
          time_to: string | null
          user_id: string
          wants: string
          weekdays: number | null
        }
        Insert: {
          created_at?: string
          dest_city_id?: string | null
          dest_junction_id?: number | null
          dest_point: unknown
          dest_street_id?: number | null
          id?: string
          origin_city_id?: string | null
          origin_junction_id?: number | null
          origin_point: unknown
          origin_street_id?: number | null
          radius_km?: number
          time_from?: string | null
          time_to?: string | null
          user_id?: string
          wants?: string
          weekdays?: number | null
        }
        Update: {
          created_at?: string
          dest_city_id?: string | null
          dest_junction_id?: number | null
          dest_point?: unknown
          dest_street_id?: number | null
          id?: string
          origin_city_id?: string | null
          origin_junction_id?: number | null
          origin_point?: unknown
          origin_street_id?: number | null
          radius_km?: number
          time_from?: string | null
          time_to?: string | null
          user_id?: string
          wants?: string
          weekdays?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "ride_saved_routes_dest_city_id_fkey"
            columns: ["dest_city_id"]
            referencedRelation: "cities"
            referencedColumns: ["city_id"]
          },
          {
            foreignKeyName: "ride_saved_routes_dest_fk"
            columns: ["dest_city_id", "dest_street_id"]
            referencedRelation: "streets"
            referencedColumns: ["city_id", "street_id"]
          },
          {
            foreignKeyName: "ride_saved_routes_dest_junction_id_fkey"
            columns: ["dest_junction_id"]
            referencedRelation: "road_junctions"
            referencedColumns: ["junction_id"]
          },
          {
            foreignKeyName: "ride_saved_routes_origin_city_id_fkey"
            columns: ["origin_city_id"]
            referencedRelation: "cities"
            referencedColumns: ["city_id"]
          },
          {
            foreignKeyName: "ride_saved_routes_origin_fk"
            columns: ["origin_city_id", "origin_street_id"]
            referencedRelation: "streets"
            referencedColumns: ["city_id", "street_id"]
          },
          {
            foreignKeyName: "ride_saved_routes_origin_junction_id_fkey"
            columns: ["origin_junction_id"]
            referencedRelation: "road_junctions"
            referencedColumns: ["junction_id"]
          },
          {
            foreignKeyName: "ride_saved_routes_user_id_fkey"
            columns: ["user_id"]
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      ride_series: {
        Row: {
          created_at: string
          depart_time: string
          duration_minutes: number | null
          ends_on: string | null
          id: string
          owner_id: string
          post_template: Json
          ride_template: Json
          starts_on: string
          status: string
          updated_at: string
          weekdays: number
        }
        Insert: {
          created_at?: string
          depart_time: string
          duration_minutes?: number | null
          ends_on?: string | null
          id?: string
          owner_id: string
          post_template: Json
          ride_template: Json
          starts_on?: string
          status?: string
          updated_at?: string
          weekdays: number
        }
        Update: {
          created_at?: string
          depart_time?: string
          duration_minutes?: number | null
          ends_on?: string | null
          id?: string
          owner_id?: string
          post_template?: Json
          ride_template?: Json
          starts_on?: string
          status?: string
          updated_at?: string
          weekdays?: number
        }
        Relationships: [
          {
            foreignKeyName: "ride_series_owner_id_fkey"
            columns: ["owner_id"]
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      road_junctions: {
        Row: {
          junction_id: number
          kind: string
          location: unknown
          name_ar: string | null
          name_en: string | null
          name_he: string
          roads: string | null
        }
        Insert: {
          junction_id: number
          kind: string
          location: unknown
          name_ar?: string | null
          name_en?: string | null
          name_he: string
          roads?: string | null
        }
        Update: {
          junction_id?: number
          kind?: string
          location?: unknown
          name_ar?: string | null
          name_en?: string | null
          name_he?: string
          roads?: string | null
        }
        Relationships: []
      }
      saved_posts: {
        Row: {
          post_id: string
          saved_at: string
          user_id: string
        }
        Insert: {
          post_id: string
          saved_at?: string
          user_id: string
        }
        Update: {
          post_id?: string
          saved_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "saved_posts_post_id_fkey"
            columns: ["post_id"]
            referencedRelation: "posts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "saved_posts_user_id_fkey"
            columns: ["user_id"]
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      streets: {
        Row: {
          city_id: string
          location: unknown
          name_he: string
          street_id: number
        }
        Insert: {
          city_id: string
          location?: unknown
          name_he: string
          street_id: number
        }
        Update: {
          city_id?: string
          location?: unknown
          name_he?: string
          street_id?: number
        }
        Relationships: [
          {
            foreignKeyName: "streets_city_id_fkey"
            columns: ["city_id"]
            referencedRelation: "cities"
            referencedColumns: ["city_id"]
          },
        ]
      }
      survey_answers: {
        Row: {
          answer_text: string | null
          choice_key: string | null
          created_at: string
          question_id: string
          rating: number | null
          updated_at: string
          user_id: string
        }
        Insert: {
          answer_text?: string | null
          choice_key?: string | null
          created_at?: string
          question_id: string
          rating?: number | null
          updated_at?: string
          user_id: string
        }
        Update: {
          answer_text?: string | null
          choice_key?: string | null
          created_at?: string
          question_id?: string
          rating?: number | null
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "survey_answers_question_id_fkey"
            columns: ["question_id"]
            referencedRelation: "survey_questions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "survey_answers_user_id_fkey"
            columns: ["user_id"]
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      survey_questions: {
        Row: {
          choice_options: Json | null
          context_he: string
          id: string
          prompt_he: string
          question_type: string
          rating_anchor_high_he: string
          rating_anchor_low_he: string
          short_label_he: string
          sort_order: number
          survey_version_id: string
          text_placeholder_he: string
        }
        Insert: {
          choice_options?: Json | null
          context_he?: string
          id?: string
          prompt_he: string
          question_type?: string
          rating_anchor_high_he?: string
          rating_anchor_low_he?: string
          short_label_he: string
          sort_order: number
          survey_version_id: string
          text_placeholder_he?: string
        }
        Update: {
          choice_options?: Json | null
          context_he?: string
          id?: string
          prompt_he?: string
          question_type?: string
          rating_anchor_high_he?: string
          rating_anchor_low_he?: string
          short_label_he?: string
          sort_order?: number
          survey_version_id?: string
          text_placeholder_he?: string
        }
        Relationships: [
          {
            foreignKeyName: "survey_questions_survey_version_id_fkey"
            columns: ["survey_version_id"]
            referencedRelation: "survey_versions"
            referencedColumns: ["id"]
          },
        ]
      }
      survey_versions: {
        Row: {
          id: string
          published_at: string
          published_by: string | null
          survey_id: string
          version: number
        }
        Insert: {
          id?: string
          published_at?: string
          published_by?: string | null
          survey_id: string
          version: number
        }
        Update: {
          id?: string
          published_at?: string
          published_by?: string | null
          survey_id?: string
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "survey_versions_published_by_fkey"
            columns: ["published_by"]
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "survey_versions_survey_id_fkey"
            columns: ["survey_id"]
            referencedRelation: "surveys"
            referencedColumns: ["id"]
          },
        ]
      }
      surveys: {
        Row: {
          created_at: string
          current_version: number
          description_he: string | null
          id: string
          is_active: boolean
          prompt_rules: Json
          slug: string
          title_he: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          current_version?: number
          description_he?: string | null
          id?: string
          is_active?: boolean
          prompt_rules?: Json
          slug: string
          title_he: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          current_version?: number
          description_he?: string | null
          id?: string
          is_active?: boolean
          prompt_rules?: Json
          slug?: string
          title_he?: string
          updated_at?: string
        }
        Relationships: []
      }
      user_account: {
        Row: {
          deletion_purge_at: string | null
          deletion_requested_at: string | null
          false_report_sanction_count: number
          false_reports_count: number
          food_posting_banned_until: string | null
          onboarding_state: string
          status: string
          status_before_deletion: string | null
          status_until: string | null
          updated_at: string
          user_id: string
          verification_method: string | null
          verified_at: string | null
        }
        Insert: {
          deletion_purge_at?: string | null
          deletion_requested_at?: string | null
          false_report_sanction_count?: number
          false_reports_count?: number
          food_posting_banned_until?: string | null
          onboarding_state?: string
          status?: string
          status_before_deletion?: string | null
          status_until?: string | null
          updated_at?: string
          user_id: string
          verification_method?: string | null
          verified_at?: string | null
        }
        Update: {
          deletion_purge_at?: string | null
          deletion_requested_at?: string | null
          false_report_sanction_count?: number
          false_reports_count?: number
          food_posting_banned_until?: string | null
          onboarding_state?: string
          status?: string
          status_before_deletion?: string | null
          status_until?: string | null
          updated_at?: string
          user_id?: string
          verification_method?: string | null
          verified_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "user_account_user_id_fkey"
            columns: ["user_id"]
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      user_consents: {
        Row: {
          accepted_at: string
          consent_kind: string
          id: string
          ip_address: unknown
          locale: string | null
          user_agent: string | null
          user_id: string
          version: number
        }
        Insert: {
          accepted_at?: string
          consent_kind: string
          id?: string
          ip_address?: unknown
          locale?: string | null
          user_agent?: string | null
          user_id: string
          version: number
        }
        Update: {
          accepted_at?: string
          consent_kind?: string
          id?: string
          ip_address?: unknown
          locale?: string | null
          user_agent?: string | null
          user_id?: string
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "user_consents_user_id_fkey"
            columns: ["user_id"]
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      user_devices: {
        Row: {
          created_at: string
          id: string
          last_seen_at: string
          platform: string
          push_token: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          last_seen_at?: string
          platform: string
          push_token: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          last_seen_at?: string
          platform?: string
          push_token?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_devices_user_id_fkey"
            columns: ["user_id"]
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      user_feedback: {
        Row: {
          body: string
          created_at: string
          id: string
          rating: number | null
          user_id: string
        }
        Insert: {
          body: string
          created_at?: string
          id?: string
          rating?: number | null
          user_id: string
        }
        Update: {
          body?: string
          created_at?: string
          id?: string
          rating?: number | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_feedback_user_id_fkey"
            columns: ["user_id"]
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      user_private: {
        Row: {
          basic_info_skipped: boolean
          closure_explainer_dismissed: boolean
          contact_phone: string | null
          date_of_birth: string | null
          first_post_nudge_dismissed: boolean
          notification_preferences: Json
          profile_street: string | null
          profile_street_number: string | null
          show_active_status: boolean
          updated_at: string
          user_id: string
        }
        Insert: {
          basic_info_skipped?: boolean
          closure_explainer_dismissed?: boolean
          contact_phone?: string | null
          date_of_birth?: string | null
          first_post_nudge_dismissed?: boolean
          notification_preferences?: Json
          profile_street?: string | null
          profile_street_number?: string | null
          show_active_status?: boolean
          updated_at?: string
          user_id: string
        }
        Update: {
          basic_info_skipped?: boolean
          closure_explainer_dismissed?: boolean
          contact_phone?: string | null
          date_of_birth?: string | null
          first_post_nudge_dismissed?: boolean
          notification_preferences?: Json
          profile_street?: string | null
          profile_street_number?: string | null
          show_active_status?: boolean
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_private_user_id_fkey"
            columns: ["user_id"]
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      user_profile_fields: {
        Row: {
          affiliated_org_id: string | null
          field_key: string
          tags: string[] | null
          updated_at: string
          user_id: string
          visibility: string
        }
        Insert: {
          affiliated_org_id?: string | null
          field_key: string
          tags?: string[] | null
          updated_at?: string
          user_id: string
          visibility: string
        }
        Update: {
          affiliated_org_id?: string | null
          field_key?: string
          tags?: string[] | null
          updated_at?: string
          user_id?: string
          visibility?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_profile_fields_affiliated_org_fk"
            columns: ["affiliated_org_id"]
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "user_profile_fields_user_id_fkey"
            columns: ["user_id"]
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      user_sanctions: {
        Row: {
          id: string
          issued_at: string
          issued_by: string | null
          kind: string
          lifted_at: string | null
          lifted_by: string | null
          note: string | null
          reason: string
          until: string | null
          user_id: string
        }
        Insert: {
          id?: string
          issued_at?: string
          issued_by?: string | null
          kind: string
          lifted_at?: string | null
          lifted_by?: string | null
          note?: string | null
          reason: string
          until?: string | null
          user_id: string
        }
        Update: {
          id?: string
          issued_at?: string
          issued_by?: string | null
          kind?: string
          lifted_at?: string | null
          lifted_by?: string | null
          note?: string | null
          reason?: string
          until?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_sanctions_issued_by_fkey"
            columns: ["issued_by"]
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "user_sanctions_lifted_by_fkey"
            columns: ["lifted_by"]
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "user_sanctions_user_id_fkey"
            columns: ["user_id"]
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      user_stats: {
        Row: {
          followers_count: number
          following_count: number
          items_given_count: number
          items_received_count: number
          karma_points: number
          open_posts_followers_only: number
          open_posts_only_me: number
          open_posts_public: number
          posts_created_total: number
          ratings_avg: number | null
          ratings_count: number
          ratings_stars_total: number
          updated_at: string
          user_id: string
          volunteer_hours_total: number
        }
        Insert: {
          followers_count?: number
          following_count?: number
          items_given_count?: number
          items_received_count?: number
          karma_points?: number
          open_posts_followers_only?: number
          open_posts_only_me?: number
          open_posts_public?: number
          posts_created_total?: number
          ratings_avg?: number | null
          ratings_count?: number
          ratings_stars_total?: number
          updated_at?: string
          user_id: string
          volunteer_hours_total?: number
        }
        Update: {
          followers_count?: number
          following_count?: number
          items_given_count?: number
          items_received_count?: number
          karma_points?: number
          open_posts_followers_only?: number
          open_posts_only_me?: number
          open_posts_public?: number
          posts_created_total?: number
          ratings_avg?: number | null
          ratings_count?: number
          ratings_stars_total?: number
          updated_at?: string
          user_id?: string
          volunteer_hours_total?: number
        }
        Relationships: [
          {
            foreignKeyName: "user_stats_user_id_fkey"
            columns: ["user_id"]
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      users: {
        Row: {
          avatar_url: string | null
          biography: string | null
          city_id: string | null
          created_at: string
          display_name: string | null
          id: string
          is_active: boolean
          preferred_language: string | null
          privacy_changed_at: string | null
          privacy_mode: string
          search_vector: unknown
          share_handle: string
          updated_at: string
          verification_level: number
        }
        Insert: {
          avatar_url?: string | null
          biography?: string | null
          city_id?: string | null
          created_at?: string
          display_name?: string | null
          id: string
          is_active?: boolean
          preferred_language?: string | null
          privacy_changed_at?: string | null
          privacy_mode?: string
          search_vector?: unknown
          share_handle: string
          updated_at?: string
          verification_level?: number
        }
        Update: {
          avatar_url?: string | null
          biography?: string | null
          city_id?: string | null
          created_at?: string
          display_name?: string | null
          id?: string
          is_active?: boolean
          preferred_language?: string | null
          privacy_changed_at?: string | null
          privacy_mode?: string
          search_vector?: unknown
          share_handle?: string
          updated_at?: string
          verification_level?: number
        }
        Relationships: [
          {
            foreignKeyName: "users_city_id_fkey"
            columns: ["city_id"]
            referencedRelation: "cities"
            referencedColumns: ["city_id"]
          },
        ]
      }
      world_links: {
        Row: {
          created_at: string
          description: string | null
          from_world_slug: string
          id: string
          is_active: boolean
          label_en: string
          label_he: string
          link_slug: string
          sort_order: number
          to_world_slug: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          description?: string | null
          from_world_slug: string
          id?: string
          is_active?: boolean
          label_en: string
          label_he: string
          link_slug: string
          sort_order?: number
          to_world_slug: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          description?: string | null
          from_world_slug?: string
          id?: string
          is_active?: boolean
          label_en?: string
          label_he?: string
          link_slug?: string
          sort_order?: number
          to_world_slug?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "world_links_from_world_slug_fkey"
            columns: ["from_world_slug"]
            referencedRelation: "worlds"
            referencedColumns: ["slug"]
          },
          {
            foreignKeyName: "world_links_to_world_slug_fkey"
            columns: ["to_world_slug"]
            referencedRelation: "worlds"
            referencedColumns: ["slug"]
          },
        ]
      }
      worlds: {
        Row: {
          created_at: string
          default_anonymity_level: number
          default_radius_km: number
          default_ttl_hours: number | null
          geo_mode: string
          geo_weight: number
          is_active: boolean
          label_en: string
          label_he: string
          requires_verification: boolean
          sensitivity: string
          shows_in_main_feed: boolean
          slug: string
          sort_order: number
        }
        Insert: {
          created_at?: string
          default_anonymity_level?: number
          default_radius_km?: number
          default_ttl_hours?: number | null
          geo_mode?: string
          geo_weight?: number
          is_active?: boolean
          label_en: string
          label_he: string
          requires_verification?: boolean
          sensitivity?: string
          shows_in_main_feed?: boolean
          slug: string
          sort_order?: number
        }
        Update: {
          created_at?: string
          default_anonymity_level?: number
          default_radius_km?: number
          default_ttl_hours?: number | null
          geo_mode?: string
          geo_weight?: number
          is_active?: boolean
          label_en?: string
          label_he?: string
          requires_verification?: boolean
          sensitivity?: string
          shows_in_main_feed?: boolean
          slug?: string
          sort_order?: number
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      accept_legal_document: {
        Args: {
          p_doc_type: string
          p_locale?: string
          p_user_agent?: string
          p_version: number
        }
        Returns: Json
      }
      accept_world_consent: {
        Args: {
          p_kind: string
          p_locale?: string
          p_user_agent?: string
          p_version: number
        }
        Returns: {
          accepted_at: string
          consent_kind: string
          id: string
          ip_address: unknown
          locale: string | null
          user_agent: string | null
          user_id: string
          version: number
        }
        SetofOptions: {
          from: "*"
          to: "user_consents"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      admin_assign_queue_entry: {
        Args: { p_assignee_id?: string; p_entry_id: string }
        Returns: undefined
      }
      admin_audit_search: {
        Args: {
          p_action?: string
          p_actor_id?: string
          p_before_id?: number
          p_before_occurred_at?: string
          p_from?: string
          p_limit?: number
          p_target_id?: string
          p_to?: string
        }
        Returns: {
          action: string
          actor_id: string
          id: number
          metadata: Json
          occurred_at: string
          target_id: string
          target_type: string
        }[]
      }
      admin_ban_user: {
        Args: { p_note?: string; p_reason: string; p_user_id: string }
        Returns: undefined
      }
      admin_change_role: {
        Args: { p_grant_id: string; p_new_role: string }
        Returns: string
      }
      admin_confirm_report: {
        Args: { p_report_id: string }
        Returns: undefined
      }
      admin_delete_comment: {
        Args: { p_comment_id: string }
        Returns: undefined
      }
      admin_delete_message: {
        Args: { p_message_id: string }
        Returns: undefined
      }
      admin_dismiss_report: {
        Args: { p_report_id: string }
        Returns: undefined
      }
      admin_grant_role: {
        Args: {
          p_role: string
          p_scope_org_id?: string
          p_target_user_id: string
        }
        Returns: string
      }
      admin_hierarchy_census: { Args: never; Returns: Json }
      admin_list_admins: {
        Args: { p_include_revoked?: boolean }
        Returns: {
          avatar_url: string
          display_name: string
          grant_id: string
          granted_at: string
          granted_by: string
          granted_by_display_name: string
          last_seen_at: string
          manager_grant_id: string
          revoked_at: string
          revoked_by: string
          role: string
          scope_org_id: string
          user_id: string
        }[]
      }
      admin_match_quality: {
        Args: { p_days?: number }
        Returns: {
          accepted: number
          chat_pairs: number
          chat_rate: number
          completed_pairs: number
          completion_rate: number
          notified_pairs: number
          precision_proxy: number
          responses: number
          world_label_en: string
          world_label_he: string
          world_slug: string
        }[]
      }
      admin_org_application_approve: {
        Args: { p_application_id: string; p_note?: string; p_slug?: string }
        Returns: string
      }
      admin_org_application_reject: {
        Args: { p_application_id: string; p_note?: string }
        Returns: undefined
      }
      admin_org_tree: {
        Args: { p_org_id?: string }
        Returns: {
          avatar_url: string
          display_name: string
          effective_org_id: string
          grant_id: string
          is_platform: boolean
          last_seen_at: string
          manager_grant_id: string
          org_name: string
          role: string
          scope_org_id: string
          user_id: string
        }[]
      }
      admin_pmf_survey_report: { Args: { p_slug?: string }; Returns: Json }
      admin_refund_payment: {
        Args: {
          p_amount_agorot: number
          p_idempotency_key: string
          p_payment_id: string
          p_reason: string
        }
        Returns: string
      }
      admin_remove_post: { Args: { p_post_id: string }; Returns: undefined }
      admin_resolve_queue_entry: {
        Args: { p_entry_id: string }
        Returns: undefined
      }
      admin_restore_post: { Args: { p_post_id: string }; Returns: undefined }
      admin_restore_user: { Args: { p_user_id: string }; Returns: undefined }
      admin_review_donation_link: {
        Args: { p_approve: boolean; p_link_id: string; p_note?: string }
        Returns: string
      }
      admin_revoke_role: { Args: { p_grant_id: string }; Returns: undefined }
      admin_set_app_flag: {
        Args: { p_description?: string; p_enabled: boolean; p_key: string }
        Returns: {
          description: string
          enabled: boolean
          key: string
          updated_at: string
          updated_by: string | null
        }
        SetofOptions: {
          from: "*"
          to: "app_flags"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      admin_set_manager: {
        Args: { p_grant_id: string; p_manager_grant_id?: string }
        Returns: undefined
      }
      admin_set_org_slug: {
        Args: { p_org_id: string; p_slug: string }
        Returns: string
      }
      admin_set_org_status: {
        Args: { p_org_id: string; p_status: string }
        Returns: undefined
      }
      admin_set_org_verification: {
        Args: {
          p_is_verified_nonprofit: boolean
          p_level: number
          p_method?: string
          p_org_id: string
        }
        Returns: undefined
      }
      admin_survey_overview: { Args: never; Returns: Json }
      admin_survey_results: { Args: { p_slug: string }; Returns: Json }
      admin_suspend_user: {
        Args: {
          p_note?: string
          p_reason: string
          p_until?: string
          p_user_id: string
        }
        Returns: undefined
      }
      admin_task_add_comment: {
        Args: { p_body: string; p_task_id: string }
        Returns: string
      }
      admin_task_assign: {
        Args: { p_new_assignee: string; p_task_id: string }
        Returns: undefined
      }
      admin_task_create: {
        Args: {
          p_assignee_id?: string
          p_category?: string
          p_description?: string
          p_due_at?: string
          p_labels?: string[]
          p_priority?: string
          p_title: string
        }
        Returns: string
      }
      admin_task_delete: { Args: { p_task_id: string }; Returns: undefined }
      admin_task_detail: { Args: { p_task_id: string }; Returns: Json }
      admin_task_list: {
        Args: {
          p_assignee?: string
          p_category?: string
          p_cursor?: Json
          p_due_from?: string
          p_due_to?: string
          p_label?: string
          p_limit?: number
          p_only_mine?: boolean
          p_overdue?: boolean
          p_priority?: string
          p_status?: string
          p_unassigned_only?: boolean
        }
        Returns: {
          cursor: Json
          task: Json
        }[]
      }
      admin_task_open_count: { Args: never; Returns: number }
      admin_task_set_status: {
        Args: { p_new_status: string; p_task_id: string }
        Returns: undefined
      }
      admin_task_update: {
        Args: {
          p_category?: string
          p_clear_due?: boolean
          p_description?: string
          p_due_at?: string
          p_labels?: string[]
          p_priority?: string
          p_task_id: string
          p_title?: string
        }
        Returns: undefined
      }
      admin_user_feedback_list: {
        Args: { p_cursor?: Json; p_limit?: number }
        Returns: {
          body: string
          created_at: string
          display_name: string
          id: string
          next_cursor: Json
          rating: number
          user_id: string
        }[]
      }
      api_donation_intent_set_checkout: {
        Args: {
          p_checkout_url: string
          p_intent_id: string
          p_provider_ref: string
        }
        Returns: undefined
      }
      api_match_llm_pending: {
        Args: { p_limit?: number }
        Returns: {
          candidate_id: string
          offer_summary: string
          offer_title: string
          request_summary: string
          request_title: string
          score: number
          world_slug: string
        }[]
      }
      api_match_llm_store: {
        Args: { p_candidate_id: string; p_reason: string; p_score: number }
        Returns: undefined
      }
      api_my_pro_status: { Args: never; Returns: Json }
      api_org_entitlement_status: { Args: { p_org_id: string }; Returns: Json }
      api_payment_method_save: {
        Args: {
          p_brand?: string
          p_last4?: string
          p_provider_slug: string
          p_provider_token: string
          p_user_id: string
        }
        Returns: string
      }
      api_payout_open: {
        Args: {
          p_amount_agorot: number
          p_idempotency_key: string
          p_org_id: string
        }
        Returns: string
      }
      api_revenuecat_set_org_entitlement: {
        Args: { p_active: boolean; p_expires_at: string; p_org_id: string }
        Returns: Json
      }
      api_revenuecat_set_pro: {
        Args: { p_active: boolean; p_expires_at: string; p_user_id: string }
        Returns: Json
      }
      api_set_org_entitlement: {
        Args: {
          p_active: boolean
          p_expires_at?: string
          p_org_id: string
          p_source?: string
        }
        Returns: Json
      }
      api_set_pro_entitlement: {
        Args: {
          p_active: boolean
          p_expires_at?: string
          p_source?: string
          p_user_id: string
        }
        Returns: Json
      }
      api_standing_orders_charge_due: {
        Args: { p_limit?: number }
        Returns: {
          amount_agorot: number
          intent_id: string
          mandate_ref: string
          standing_order_id: string
        }[]
      }
      book_knowledge_seat: {
        Args: { p_slot_id: string }
        Returns: {
          cancel_reason: string | null
          cancelled_at: string | null
          confirm_by: string | null
          confirmed_at: string | null
          created_at: string
          handed_over_at: string | null
          id: string
          machine_id: string
          no_show_at: string | null
          owner_id: string
          pickup_mode: string
          pickup_window_end: string | null
          pickup_window_start: string | null
          post_id: string
          recipient_id: string
          requested_meeting_point: Json | null
          seats: number
          slot_ends_at: string | null
          slot_starts_at: string | null
          status: string
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "post_handoffs"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      book_ride_seat: {
        Args: {
          p_post_id: string
          p_requested_meeting_point?: Json
          p_seats?: number
        }
        Returns: {
          cancel_reason: string | null
          cancelled_at: string | null
          confirm_by: string | null
          confirmed_at: string | null
          created_at: string
          handed_over_at: string | null
          id: string
          machine_id: string
          no_show_at: string | null
          owner_id: string
          pickup_mode: string
          pickup_window_end: string | null
          pickup_window_start: string | null
          post_id: string
          recipient_id: string
          requested_meeting_point: Json | null
          seats: number
          slot_ends_at: string | null
          slot_starts_at: string | null
          status: string
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "post_handoffs"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      bootstrap_session: { Args: never; Returns: Json }
      cancel_event_registration: {
        Args: { p_handoff_id: string }
        Returns: {
          cancel_reason: string | null
          cancelled_at: string | null
          confirm_by: string | null
          confirmed_at: string | null
          created_at: string
          handed_over_at: string | null
          id: string
          machine_id: string
          no_show_at: string | null
          owner_id: string
          pickup_mode: string
          pickup_window_end: string | null
          pickup_window_start: string | null
          post_id: string
          recipient_id: string
          requested_meeting_point: Json | null
          seats: number
          slot_ends_at: string | null
          slot_starts_at: string | null
          status: string
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "post_handoffs"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      cancel_giving_handoff: {
        Args: { p_handoff_id: string }
        Returns: {
          cancel_reason: string | null
          cancelled_at: string | null
          confirm_by: string | null
          confirmed_at: string | null
          created_at: string
          handed_over_at: string | null
          id: string
          machine_id: string
          no_show_at: string | null
          owner_id: string
          pickup_mode: string
          pickup_window_end: string | null
          pickup_window_start: string | null
          post_id: string
          recipient_id: string
          requested_meeting_point: Json | null
          seats: number
          slot_ends_at: string | null
          slot_starts_at: string | null
          status: string
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "post_handoffs"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      cancel_housing_booking: {
        Args: { p_handoff_id: string; p_note?: string }
        Returns: {
          cancel_reason: string | null
          cancelled_at: string | null
          confirm_by: string | null
          confirmed_at: string | null
          created_at: string
          handed_over_at: string | null
          id: string
          machine_id: string
          no_show_at: string | null
          owner_id: string
          pickup_mode: string
          pickup_window_end: string | null
          pickup_window_start: string | null
          post_id: string
          recipient_id: string
          requested_meeting_point: Json | null
          seats: number
          slot_ends_at: string | null
          slot_starts_at: string | null
          status: string
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "post_handoffs"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      cancel_post_series_date: {
        Args: { p_post_id: string }
        Returns: undefined
      }
      cancel_ride_booking: {
        Args: { p_handoff_id: string }
        Returns: {
          cancel_reason: string | null
          cancelled_at: string | null
          confirm_by: string | null
          confirmed_at: string | null
          created_at: string
          handed_over_at: string | null
          id: string
          machine_id: string
          no_show_at: string | null
          owner_id: string
          pickup_mode: string
          pickup_window_end: string | null
          pickup_window_start: string | null
          post_id: string
          recipient_id: string
          requested_meeting_point: Json | null
          seats: number
          slot_ends_at: string | null
          slot_starts_at: string | null
          status: string
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "post_handoffs"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      cancel_standing_order: { Args: { p_order_id: string }; Returns: Json }
      chat_counterpart_contact: { Args: { p_chat_id: string }; Returns: string }
      chat_inbox_page: {
        Args: {
          p_before_chat_id?: string
          p_before_last_message_at?: string
          p_limit?: number
          p_search?: string
        }
        Returns: {
          anchor_post_id: string
          chat_id: string
          counterpart_avatar_url: string
          counterpart_display_name: string
          counterpart_id: string
          counterpart_last_read_at: string
          counterpart_share_handle: string
          counterpart_verification_level: number
          kind: string
          last_message_at: string
          last_message_id: string
          last_message_kind: string
          last_message_media_type: string
          last_message_preview: string
          last_message_sender_id: string
          last_message_system_payload: Json
          unread_count: number
        }[]
      }
      chat_messages_page: {
        Args: {
          p_after?: string
          p_before?: string
          p_chat_id: string
          p_limit?: number
        }
        Returns: {
          body: string | null
          chat_id: string
          created_at: string
          id: string
          kind: string
          media_payload: Json | null
          sender_id: string | null
          source_language: string | null
          system_payload: Json | null
        }[]
        SetofOptions: {
          from: "*"
          to: "messages"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      chat_unread_counts: {
        Args: { p_chat_ids: string[] }
        Returns: {
          chat_id: string
          unread_count: number
        }[]
      }
      chat_unread_total: { Args: never; Returns: number }
      check_survey_prompt_eligibility: {
        Args: { p_session_count: number; p_slug: string }
        Returns: Json
      }
      claim_food_giving: {
        Args: {
          p_pickup_window_end?: string
          p_pickup_window_start?: string
          p_post_id: string
        }
        Returns: {
          cancel_reason: string | null
          cancelled_at: string | null
          confirm_by: string | null
          confirmed_at: string | null
          created_at: string
          handed_over_at: string | null
          id: string
          machine_id: string
          no_show_at: string | null
          owner_id: string
          pickup_mode: string
          pickup_window_end: string | null
          pickup_window_start: string | null
          post_id: string
          recipient_id: string
          requested_meeting_point: Json | null
          seats: number
          slot_ends_at: string | null
          slot_starts_at: string | null
          status: string
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "post_handoffs"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      close_housing_booking: {
        Args: { p_handoff_id: string; p_outcome: string }
        Returns: {
          cancel_reason: string | null
          cancelled_at: string | null
          confirm_by: string | null
          confirmed_at: string | null
          created_at: string
          handed_over_at: string | null
          id: string
          machine_id: string
          no_show_at: string | null
          owner_id: string
          pickup_mode: string
          pickup_window_end: string | null
          pickup_window_start: string | null
          post_id: string
          recipient_id: string
          requested_meeting_point: Json | null
          seats: number
          slot_ends_at: string | null
          slot_starts_at: string | null
          status: string
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "post_handoffs"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      close_post_with_recipient: {
        Args: { p_post_id: string; p_recipient_id: string }
        Returns: {
          cancel_reason: string | null
          cancelled_at: string | null
          confirm_by: string | null
          confirmed_at: string | null
          created_at: string
          handed_over_at: string | null
          id: string
          machine_id: string
          no_show_at: string | null
          owner_id: string
          pickup_mode: string
          pickup_window_end: string | null
          pickup_window_start: string | null
          post_id: string
          recipient_id: string
          requested_meeting_point: Json | null
          seats: number
          slot_ends_at: string | null
          slot_starts_at: string | null
          status: string
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "post_handoffs"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      close_post_without_recipient: {
        Args: { p_post_id: string }
        Returns: undefined
      }
      community_stats: {
        Args: never
        Returns: {
          delivered_posts: number
          open_public_posts: number
          refreshed_at: string
          registered_users: number
        }[]
      }
      complete_ride: { Args: { p_post_id: string }; Returns: number }
      complete_ride_trip: {
        Args: { p_handoff_id: string }
        Returns: {
          cancel_reason: string | null
          cancelled_at: string | null
          confirm_by: string | null
          confirmed_at: string | null
          created_at: string
          handed_over_at: string | null
          id: string
          machine_id: string
          no_show_at: string | null
          owner_id: string
          pickup_mode: string
          pickup_window_end: string | null
          pickup_window_start: string | null
          post_id: string
          recipient_id: string
          requested_meeting_point: Json | null
          seats: number
          slot_ends_at: string | null
          slot_starts_at: string | null
          status: string
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "post_handoffs"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      confirm_item_handoff: {
        Args: { p_handoff_id: string }
        Returns: {
          cancel_reason: string | null
          cancelled_at: string | null
          confirm_by: string | null
          confirmed_at: string | null
          created_at: string
          handed_over_at: string | null
          id: string
          machine_id: string
          no_show_at: string | null
          owner_id: string
          pickup_mode: string
          pickup_window_end: string | null
          pickup_window_start: string | null
          post_id: string
          recipient_id: string
          requested_meeting_point: Json | null
          seats: number
          slot_ends_at: string | null
          slot_starts_at: string | null
          status: string
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "post_handoffs"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      confirm_ride_booking: {
        Args: { p_handoff_id: string }
        Returns: {
          cancel_reason: string | null
          cancelled_at: string | null
          confirm_by: string | null
          confirmed_at: string | null
          created_at: string
          handed_over_at: string | null
          id: string
          machine_id: string
          no_show_at: string | null
          owner_id: string
          pickup_mode: string
          pickup_window_end: string | null
          pickup_window_start: string | null
          post_id: string
          recipient_id: string
          requested_meeting_point: Json | null
          seats: number
          slot_ends_at: string | null
          slot_starts_at: string | null
          status: string
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "post_handoffs"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      create_challenge: {
        Args: {
          p_cadence: string
          p_city_id?: string
          p_description?: string
          p_difficulty?: string
          p_ends_at?: string
          p_goal_direction?: string
          p_goal_value?: number
          p_measurement: string
          p_scope: string
          p_target_cycles?: number
          p_title: string
          p_topic_label?: string
        }
        Returns: string
      }
      create_donation_intent: {
        Args: {
          p_amount_agorot: number
          p_idempotency_key: string
          p_org_id: string
          p_post_id?: string
        }
        Returns: Json
      }
      create_post_series: {
        Args: {
          p_duration_minutes: number
          p_ends_on?: string
          p_event: Json
          p_org_id?: string
          p_post: Json
          p_start_time: string
          p_time_zone?: string
          p_weekdays: number
        }
        Returns: string
      }
      create_post_with_details: {
        Args: { p_details: Json; p_post: Json }
        Returns: string
      }
      create_ride_series: {
        Args: {
          p_depart_time: string
          p_duration_minutes?: number
          p_ends_on?: string
          p_post: Json
          p_ride: Json
          p_weekdays: number
        }
        Returns: string
      }
      create_standing_order: {
        Args: {
          p_amount_agorot: number
          p_cadence?: string
          p_idempotency_key: string
          p_org_id: string
        }
        Returns: Json
      }
      crm_contact_count: {
        Args: {
          p_org_id: string
          p_query?: string
          p_status?: string
          p_tag?: string
        }
        Returns: number
      }
      crm_contact_delete: { Args: { p_contact_id: string }; Returns: undefined }
      crm_contact_list: {
        Args: {
          p_cursor?: Json
          p_limit?: number
          p_org_id: string
          p_query?: string
          p_status?: string
          p_tag?: string
        }
        Returns: {
          contact: Json
          cursor: Json
        }[]
      }
      crm_contact_mark_contacted: {
        Args: { p_contact_id: string }
        Returns: undefined
      }
      crm_contact_upsert: {
        Args: {
          p_contact_id?: string
          p_email?: string
          p_name?: string
          p_notes?: string
          p_org_id: string
          p_organization?: string
          p_phone?: string
          p_role_title?: string
          p_status?: string
          p_tags?: string[]
        }
        Returns: string
      }
      crm_my_orgs: {
        Args: never
        Returns: {
          is_platform: boolean
          name: string
          org_id: string
        }[]
      }
      decide_event_registration: {
        Args: { p_approve: boolean; p_handoff_id: string }
        Returns: {
          cancel_reason: string | null
          cancelled_at: string | null
          confirm_by: string | null
          confirmed_at: string | null
          created_at: string
          handed_over_at: string | null
          id: string
          machine_id: string
          no_show_at: string | null
          owner_id: string
          pickup_mode: string
          pickup_window_end: string | null
          pickup_window_start: string | null
          post_id: string
          recipient_id: string
          requested_meeting_point: Json | null
          seats: number
          slot_ends_at: string | null
          slot_starts_at: string | null
          status: string
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "post_handoffs"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      decide_housing_booking: {
        Args: { p_approve: boolean; p_handoff_id: string; p_note?: string }
        Returns: {
          cancel_reason: string | null
          cancelled_at: string | null
          confirm_by: string | null
          confirmed_at: string | null
          created_at: string
          handed_over_at: string | null
          id: string
          machine_id: string
          no_show_at: string | null
          owner_id: string
          pickup_mode: string
          pickup_window_end: string | null
          pickup_window_start: string | null
          post_id: string
          recipient_id: string
          requested_meeting_point: Json | null
          seats: number
          slot_ends_at: string | null
          slot_starts_at: string | null
          status: string
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "post_handoffs"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      delete_post: { Args: { p_post_id: string }; Returns: undefined }
      delete_post_comment: {
        Args: { p_comment_id: string }
        Returns: undefined
      }
      embedding_job_fail: {
        Args: { p_error: string; p_job_id: string }
        Returns: undefined
      }
      embedding_job_store: {
        Args: { p_embedding: string; p_job_id: string; p_model: string }
        Returns: boolean
      }
      embedding_jobs_claim: {
        Args: { p_limit?: number }
        Returns: {
          details: Json
          job_id: string
          model: string
          post_id: string
          summary: string
          title: string
        }[]
      }
      end_challenge: { Args: { p_challenge_id: string }; Returns: undefined }
      feed_page: {
        Args: { p_cursor?: Json; p_filters?: Json; p_limit?: number }
        Returns: {
          card: Database["public"]["CompositeTypes"]["post_card"]
          distance_m: number
          next_cursor: Json
        }[]
      }
      finance_account_upsert: {
        Args: {
          p_account_id?: string
          p_is_active?: boolean
          p_kind?: string
          p_last4?: string
          p_name?: string
          p_opening_balance_agorot?: number
          p_opening_balance_at?: string
          p_org_id: string
        }
        Returns: string
      }
      finance_accounts_list: {
        Args: { p_org_id: string }
        Returns: {
          balance_agorot: number
          id: string
          is_active: boolean
          kind: string
          last4: string
          name: string
          opening_balance_agorot: number
          opening_balance_at: string
          sort_order: number
        }[]
      }
      finance_donors_summary: {
        Args: { p_limit?: number; p_org_id: string }
        Returns: {
          donations_count: number
          donor_name: string
          first_at: string
          last_at: string
          total_agorot: number
        }[]
      }
      finance_ledger_list: {
        Args: {
          p_after_id?: string
          p_after_occurred_at?: string
          p_direction?: string
          p_from?: string
          p_limit?: number
          p_org_id: string
          p_status?: string
          p_to?: string
        }
        Returns: {
          account_id: string
          amount_agorot: number
          category: string
          counterparty: string
          created_at: string
          currency: string
          description: string
          direction: string
          id: string
          is_public: boolean
          kind: string
          occurred_at: string
          reconciled_at: string
          source: string
          status: string
          updated_at: string
          void_reason: string
        }[]
      }
      finance_ledger_mark: {
        Args: {
          p_entry_id: string
          p_org_id: string
          p_reconciled?: boolean
          p_void_reason?: string
        }
        Returns: undefined
      }
      finance_ledger_summary: {
        Args: { p_from?: string; p_org_id: string; p_to?: string }
        Returns: {
          currency: string
          entry_count: number
          expense_agorot: number
          income_agorot: number
          net_agorot: number
        }[]
      }
      finance_ledger_upsert: {
        Args: {
          p_account_id?: string
          p_amount_agorot?: number
          p_category?: string
          p_counterparty?: string
          p_description?: string
          p_entry_id?: string
          p_is_public?: boolean
          p_kind?: string
          p_occurred_at?: string
          p_org_id: string
          p_status?: string
        }
        Returns: string
      }
      finance_sec46_set: {
        Args: {
          p_approval_number?: string
          p_org_id: string
          p_status: string
          p_valid_from?: string
          p_valid_until?: string
        }
        Returns: undefined
      }
      finance_transparency_settings_set: {
        Args: { p_org_id: string; p_settings: Json }
        Returns: undefined
      }
      follow_request_cancel: { Args: { p_target: string }; Returns: undefined }
      follow_request_decide: {
        Args: { p_accept: boolean; p_requester: string }
        Returns: undefined
      }
      follow_user: { Args: { p_target: string }; Returns: string }
      get_challenge: {
        Args: { p_challenge_id: string }
        Returns: Database["public"]["CompositeTypes"]["challenge_summary"][]
        SetofOptions: {
          from: "*"
          to: "challenge_summary"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      get_donation_receipt: { Args: { p_payment_id: string }; Returns: Json }
      get_my_admin_roles: { Args: never; Returns: string[] }
      get_nonprofit_public_page: { Args: { p_org_slug: string }; Returns: Json }
      get_post_private_location: {
        Args: { p_post_id: string }
        Returns: {
          access_notes: string | null
          destination_street_number: string | null
          exact_point: unknown
          post_id: string
          street: string | null
          street_number: string | null
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "post_private_locations"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      get_post_translations: {
        Args: { p_post_ids: string[]; p_target_language: string }
        Returns: {
          confidence: number
          field: string
          post_id: string
          source_language: string
          translated_text: string
        }[]
      }
      get_public_research_questions: { Args: { p_slug: string }; Returns: Json }
      get_research_salt: { Args: never; Returns: string }
      hide_chat: { Args: { p_chat_id: string }; Returns: undefined }
      housing_completed_stays: {
        Args: { p_user_ids: string[] }
        Returns: {
          completed_stays: number
          user_id: string
        }[]
      }
      join_challenge: { Args: { p_challenge_id: string }; Returns: undefined }
      knowledge_slot_seats: {
        Args: { p_post_id: string }
        Returns: {
          capacity: number
          ends_at: string
          id: string
          seats_left: number
          seats_taken: number
          starts_at: string
        }[]
      }
      leave_challenge: { Args: { p_challenge_id: string }; Returns: undefined }
      list_challenge_leaderboard: {
        Args: { p_challenge_id: string; p_limit?: number }
        Returns: {
          avatar_url: string
          best_streak: number
          completed: boolean
          current_streak: number
          display_name: string
          is_me: boolean
          successful_cycles: number
          user_id: string
        }[]
      }
      list_challenges: {
        Args: { p_cursor?: Json; p_limit?: number; p_view?: string }
        Returns: {
          challenge: Database["public"]["CompositeTypes"]["challenge_summary"]
          next_cursor: Json
        }[]
      }
      list_my_donation_history: {
        Args: {
          p_after_id?: string
          p_after_paid_at?: string
          p_limit?: number
        }
        Returns: {
          amount_agorot: number
          currency: string
          org_id: string
          org_name: string
          paid_at: string
          payment_id: string
          receipt_serial: number
          refunded_agorot: number
          sec46_eligible: boolean
          standing_order_id: string
          status: string
        }[]
      }
      list_my_standing_orders: { Args: never; Returns: Json[] }
      list_org_members: {
        Args: { p_org_id: string }
        Returns: {
          avatar_url: string
          display_name: string
          joined_at: string
          role: string
          share_handle: string
          user_id: string
        }[]
      }
      list_verified_nonprofits: {
        Args: { p_after_id?: string; p_after_name?: string; p_limit?: number }
        Returns: {
          id: string
          name: string
          slug: string
          tagline_en: string
          tagline_he: string
          verification_level: number
        }[]
      }
      map_post_clusters: {
        Args: { p_bounds: Json; p_filters?: Json; p_zoom: number }
        Returns: {
          lat: number
          lng: number
          post_count: number
          single_post_id: string
        }[]
      }
      map_post_pins: {
        Args: { p_bounds: Json; p_filters?: Json; p_limit?: number }
        Returns: {
          direction: string
          lat: number
          lng: number
          post_id: string
          world_slug: string
        }[]
      }
      mark_chat_read: { Args: { p_chat_id: string }; Returns: undefined }
      mark_event_attendance: {
        Args: { p_attended: boolean; p_handoff_id: string }
        Returns: {
          cancel_reason: string | null
          cancelled_at: string | null
          confirm_by: string | null
          confirmed_at: string | null
          created_at: string
          handed_over_at: string | null
          id: string
          machine_id: string
          no_show_at: string | null
          owner_id: string
          pickup_mode: string
          pickup_window_end: string | null
          pickup_window_start: string | null
          post_id: string
          recipient_id: string
          requested_meeting_point: Json | null
          seats: number
          slot_ends_at: string | null
          slot_starts_at: string | null
          status: string
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "post_handoffs"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      mark_giving_handed_over: {
        Args: { p_handoff_id: string }
        Returns: {
          cancel_reason: string | null
          cancelled_at: string | null
          confirm_by: string | null
          confirmed_at: string | null
          created_at: string
          handed_over_at: string | null
          id: string
          machine_id: string
          no_show_at: string | null
          owner_id: string
          pickup_mode: string
          pickup_window_end: string | null
          pickup_window_start: string | null
          post_id: string
          recipient_id: string
          requested_meeting_point: Json | null
          seats: number
          slot_ends_at: string | null
          slot_starts_at: string | null
          status: string
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "post_handoffs"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      match_respond: {
        Args: { p_accept: boolean; p_match_id: string }
        Returns: string
      }
      message_event_registrants: {
        Args: { p_body: string; p_post_id: string }
        Returns: number
      }
      my_activity_timeline: {
        Args: { p_limit?: number }
        Returns: {
          actor_display_name: string
          actor_id: string
          kind: string
          occurred_at: string
          post_id: string
          post_title: string
          world_slug: string
        }[]
      }
      my_karma_points: { Args: never; Returns: number }
      my_matches: {
        Args: { p_limit?: number }
        Returns: {
          created_at: string
          distance_km: number
          llm_reason: string
          match_id: string
          my_post_id: string
          my_post_title: string
          my_response: string
          my_role: string
          other_post: Database["public"]["CompositeTypes"]["post_card"]
          other_response: string
          score: number
          status: string
          world_slug: string
        }[]
      }
      notifications_mark_all_read: { Args: never; Returns: number }
      notifications_mark_read: { Args: { p_ids: string[] }; Returns: number }
      notifications_page: {
        Args: {
          p_before_created_at?: string
          p_before_id?: string
          p_category?: string
          p_limit?: number
        }
        Returns: {
          actor_avatar_url: string
          actor_display_name: string
          actor_ids: string[]
          body_key: string
          category: string
          created_at: string
          data: Json
          entity_id: string
          entity_type: string
          group_count: number
          id: string
          kind: string
          read_at: string
          title_key: string
          updated_at: string
          world_slug: string
        }[]
      }
      notifications_unread_count: { Args: never; Returns: number }
      open_direct_chat: {
        Args: { p_anchor_post_id?: string; p_user_id: string }
        Returns: {
          anchor_post_id: string | null
          created_at: string
          direct_user_a: string | null
          direct_user_b: string | null
          id: string
          kind: string
          last_message_at: string | null
          moderation_hidden_at: string | null
          support_user_id: string | null
        }
        SetofOptions: {
          from: "*"
          to: "chats"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      open_support_thread: {
        Args: never
        Returns: {
          anchor_post_id: string | null
          created_at: string
          direct_user_a: string | null
          direct_user_b: string | null
          id: string
          kind: string
          last_message_at: string | null
          moderation_hidden_at: string | null
          support_user_id: string | null
        }
        SetofOptions: {
          from: "*"
          to: "chats"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      org_add_member: {
        Args: { p_org_id: string; p_role?: string; p_share_handle: string }
        Returns: string
      }
      org_remove_member: {
        Args: { p_org_id: string; p_user_id: string }
        Returns: undefined
      }
      pause_post: { Args: { p_post_id: string }; Returns: undefined }
      pause_standing_order: { Args: { p_order_id: string }; Returns: Json }
      post_cards: {
        Args: { p_post_ids: string[] }
        Returns: Database["public"]["CompositeTypes"]["post_card"][]
        SetofOptions: {
          from: "*"
          to: "post_card"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      post_comments_page: {
        Args: {
          p_cursor?: Json
          p_limit?: number
          p_parent_comment_id?: string
          p_post_id: string
        }
        Returns: {
          author_avatar_url: string
          author_display_name: string
          author_id: string
          author_identity_masked: boolean
          author_share_handle: string
          body: string
          created_at: string
          edited_at: string
          id: string
          mention_user_ids: string[]
          next_cursor: Json
          parent_comment_id: string
          post_id: string
          reactions_count: number
          replies_count: number
          viewer_reacted: boolean
        }[]
      }
      post_detail: { Args: { p_post_id: string }; Returns: Json }
      post_seat_counts: {
        Args: { p_post_ids: string[] }
        Returns: {
          capacity: number
          post_id: string
          seats_left: number
          seats_taken: number
          waitlisted: number
        }[]
      }
      profile_closed_posts_count: {
        Args: { p_user_id: string }
        Returns: number
      }
      profile_posts_page: {
        Args: {
          p_cursor?: Json
          p_limit?: number
          p_statuses?: string[]
          p_tab?: string
          p_user_id: string
        }
        Returns: {
          card: Database["public"]["CompositeTypes"]["post_card"]
          next_cursor: Json
        }[]
      }
      provider_webhook_apply: {
        Args: { p_event_id: string; p_payload: Json; p_provider_slug: string }
        Returns: {
          event_error_code: string
          event_status: string
          webhook_event_id: string
        }[]
      }
      publish_post: { Args: { p_post_id: string }; Returns: undefined }
      publish_survey_version: {
        Args: {
          p_description_he: string
          p_is_active: boolean
          p_prompt_rules: Json
          p_questions: Json
          p_slug: string
          p_title_he: string
        }
        Returns: number
      }
      rate_handoff: {
        Args: { p_comment?: string; p_handoff_id: string; p_stars: number }
        Returns: undefined
      }
      recipient_unmark_self: { Args: { p_post_id: string }; Returns: undefined }
      recommended_posts: {
        Args: { p_limit?: number }
        Returns: Database["public"]["CompositeTypes"]["post_card"][]
        SetofOptions: {
          from: "*"
          to: "post_card"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      record_active_day: { Args: never; Returns: undefined }
      register_for_event: {
        Args: { p_post_id: string }
        Returns: {
          cancel_reason: string | null
          cancelled_at: string | null
          confirm_by: string | null
          confirmed_at: string | null
          created_at: string
          handed_over_at: string | null
          id: string
          machine_id: string
          no_show_at: string | null
          owner_id: string
          pickup_mode: string
          pickup_window_end: string | null
          pickup_window_start: string | null
          post_id: string
          recipient_id: string
          requested_meeting_point: Json | null
          seats: number
          slot_ends_at: string | null
          slot_starts_at: string | null
          status: string
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "post_handoffs"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      reinstate_ride_booking: {
        Args: { p_handoff_id: string }
        Returns: {
          cancel_reason: string | null
          cancelled_at: string | null
          confirm_by: string | null
          confirmed_at: string | null
          created_at: string
          handed_over_at: string | null
          id: string
          machine_id: string
          no_show_at: string | null
          owner_id: string
          pickup_mode: string
          pickup_window_end: string | null
          pickup_window_start: string | null
          post_id: string
          recipient_id: string
          requested_meeting_point: Json | null
          seats: number
          slot_ends_at: string | null
          slot_starts_at: string | null
          status: string
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "post_handoffs"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      reopen_post: { Args: { p_post_id: string }; Returns: undefined }
      report_challenge_progress: {
        Args: {
          p_challenge_id: string
          p_note?: string
          p_report_date?: string
          p_value: number
        }
        Returns: Json
      }
      report_donation_link: { Args: { p_link_id: string }; Returns: undefined }
      report_post_emergency: {
        Args: {
          p_lat?: number
          p_lng?: number
          p_note?: string
          p_post_id: string
        }
        Returns: string
      }
      request_account_deletion: { Args: never; Returns: string }
      request_housing_booking: {
        Args: {
          p_adults: number
          p_check_in: string
          p_check_out: string
          p_message?: string
          p_minors?: number
          p_minors_guardian_ack?: boolean
          p_post_id: string
        }
        Returns: {
          cancel_reason: string | null
          cancelled_at: string | null
          confirm_by: string | null
          confirmed_at: string | null
          created_at: string
          handed_over_at: string | null
          id: string
          machine_id: string
          no_show_at: string | null
          owner_id: string
          pickup_mode: string
          pickup_window_end: string | null
          pickup_window_start: string | null
          post_id: string
          recipient_id: string
          requested_meeting_point: Json | null
          seats: number
          slot_ends_at: string | null
          slot_starts_at: string | null
          status: string
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "post_handoffs"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      reserve_item_giving: {
        Args: {
          p_pickup_mode?: string
          p_pickup_window_end?: string
          p_pickup_window_start?: string
          p_post_id: string
        }
        Returns: {
          cancel_reason: string | null
          cancelled_at: string | null
          confirm_by: string | null
          confirmed_at: string | null
          created_at: string
          handed_over_at: string | null
          id: string
          machine_id: string
          no_show_at: string | null
          owner_id: string
          pickup_mode: string
          pickup_window_end: string | null
          pickup_window_start: string | null
          post_id: string
          recipient_id: string
          requested_meeting_point: Json | null
          seats: number
          slot_ends_at: string | null
          slot_starts_at: string | null
          status: string
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "post_handoffs"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      restore_account: { Args: never; Returns: undefined }
      resume_post: { Args: { p_post_id: string }; Returns: undefined }
      resume_standing_order: { Args: { p_order_id: string }; Returns: Json }
      ride_occurrence_schedules: {
        Args: { p_post_ids: string[] }
        Returns: {
          depart_time: string
          ends_on: string
          post_id: string
          series_id: string
          series_on: string
          weekdays: number
        }[]
      }
      rides_feed: {
        Args: { p_cursor?: Json; p_filters?: Json; p_limit?: number }
        Returns: {
          arrives_at: string
          departs_at: string
          dest_name: string
          direction: string
          meeting_points: Json
          next_cursor: Json
          origin_name: string
          owner_id: string
          post_id: string
          reward_model: string
          seats: number
          seats_left: number
          series_depart_time: string
          series_id: string
          series_more: number
          series_on: string
          series_weekdays: number
          title: string
        }[]
      }
      rotate_research_salt: { Args: never; Returns: string }
      rpc_org_transparency: { Args: { p_slug?: string }; Returns: Json }
      search_all: { Args: { p_limit?: number; p_query: string }; Returns: Json }
      search_places: {
        Args: { p_kinds?: string[]; p_limit?: number; p_query: string }
        Returns: {
          city_id: string
          junction_kind: string
          lat: number
          lng: number
          name_en: string
          name_he: string
          place_id: string
          place_kind: string
          roads: string
        }[]
      }
      search_posts_page: {
        Args: {
          p_cursor?: Json
          p_filters?: Json
          p_limit?: number
          p_query: string
        }
        Returns: {
          card: Database["public"]["CompositeTypes"]["post_card"]
          distance_m: number
          next_cursor: Json
        }[]
      }
      search_users_page: {
        Args: {
          p_cursor?: Json
          p_filters?: Json
          p_limit?: number
          p_query: string
        }
        Returns: {
          avatar_url: string
          city_id: string
          display_name: string
          followers_count: number
          id: string
          next_cursor: Json
          privacy_mode: string
          share_handle: string
          verification_level: number
          viewer_follows: boolean
        }[]
      }
      send_message: {
        Args: {
          p_body: string
          p_chat_id: string
          p_media_payload?: Json
          p_message_id?: string
        }
        Returns: {
          body: string | null
          chat_id: string
          created_at: string
          id: string
          kind: string
          media_payload: Json | null
          sender_id: string | null
          source_language: string | null
          system_payload: Json | null
        }
        SetofOptions: {
          from: "*"
          to: "messages"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      set_date_of_birth: { Args: { p_date: string }; Returns: undefined }
      set_message_reaction: {
        Args: { p_message_id: string; p_reaction_type: string }
        Returns: undefined
      }
      set_onboarding_state: { Args: { p_state: string }; Returns: undefined }
      set_post_organization: {
        Args: { p_org_id: string; p_post_id: string }
        Returns: undefined
      }
      set_post_reaction: {
        Args: { p_post_id: string; p_reaction_type: string }
        Returns: string
      }
      set_post_series_status: {
        Args: { p_series_id: string; p_status: string }
        Returns: undefined
      }
      set_privacy_mode: { Args: { p_mode: string }; Returns: undefined }
      set_ride_series_status: {
        Args: { p_series_id: string; p_status: string }
        Returns: undefined
      }
      similar_posts: {
        Args: { p_limit?: number; p_post_id: string }
        Returns: Database["public"]["CompositeTypes"]["post_card"][]
        SetofOptions: {
          from: "*"
          to: "post_card"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      submit_org_application: {
        Args: {
          p_contact_email: string
          p_contact_phone?: string
          p_declared_nonprofit?: boolean
          p_org_description: string
          p_org_name: string
          p_website_url?: string
        }
        Returns: string
      }
      submit_public_research_response: {
        Args: {
          p_answers: Json
          p_contact_email?: string
          p_contact_window_he?: string
          p_honeypot: string
          p_ip_hash: string
          p_slug: string
          p_source: string
          p_user_agent_hash: string
          p_version: number
        }
        Returns: string
      }
      timesheet_approve: {
        Args: { p_entry_id: string; p_note?: string }
        Returns: undefined
      }
      timesheet_count: {
        Args: {
          p_from?: string
          p_scope?: string
          p_status?: string
          p_to?: string
          p_user_id?: string
        }
        Returns: number
      }
      timesheet_delete: { Args: { p_entry_id: string }; Returns: undefined }
      timesheet_list: {
        Args: {
          p_cursor?: Json
          p_from?: string
          p_limit?: number
          p_scope?: string
          p_status?: string
          p_to?: string
          p_user_id?: string
        }
        Returns: {
          cursor: Json
          entry: Json
        }[]
      }
      timesheet_reject: {
        Args: { p_entry_id: string; p_note?: string }
        Returns: undefined
      }
      timesheet_submit: { Args: { p_entry_id: string }; Returns: undefined }
      timesheet_upsert: {
        Args: {
          p_description?: string
          p_entry_id?: string
          p_hours_x100?: number
          p_project?: string
          p_work_date?: string
        }
        Returns: string
      }
      update_post_series: {
        Args: {
          p_duration_minutes: number
          p_ends_on?: string
          p_event?: Json
          p_post?: Json
          p_series_id: string
          p_start_time: string
          p_weekdays: number
        }
        Returns: undefined
      }
      update_ride_series: {
        Args: {
          p_depart_time: string
          p_duration_minutes?: number
          p_ends_on?: string
          p_series_id: string
          p_weekdays: number
        }
        Returns: undefined
      }
      upsert_post_actor_identity: {
        Args: {
          p_hide_from_counterparty: boolean
          p_identity_visibility?: string
          p_post_id: string
          p_surface_visibility: string
        }
        Returns: undefined
      }
      upsert_survey_answers: {
        Args: { p_answers: Json; p_slug: string }
        Returns: undefined
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      challenge_summary: {
        id: string | null
        post_id: string | null
        creator_id: string | null
        creator_display_name: string | null
        title: string | null
        description: string | null
        scope: string | null
        measurement: string | null
        cadence: string | null
        goal_value: number | null
        goal_direction: string | null
        difficulty: string | null
        topic_label: string | null
        ends_at: string | null
        target_cycles: number | null
        status: string | null
        participants_count: number | null
        created_at: string | null
        joined: boolean | null
        my_current_streak: number | null
        my_best_streak: number | null
        my_successful_cycles: number | null
        my_completed: boolean | null
      }
      post_card: {
        id: string | null
        owner_id: string | null
        world_slug: string | null
        kind_id: string | null
        post_type: string | null
        direction: string | null
        status: string | null
        visibility: string | null
        title: string | null
        description: string | null
        item_subcategory_id: string | null
        details: Json | null
        city_id: string | null
        city_name_he: string | null
        city_name_en: string | null
        location_display_level: string | null
        time_window: unknown
        urgency_level: number | null
        expires_at: string | null
        published_at: string | null
        created_at: string | null
        owner_display_name: string | null
        owner_share_handle: string | null
        owner_avatar_url: string | null
        owner_verification_level: number | null
        cover_media: Json | null
        media_count: number | null
        reactions_count: number | null
        comments_count: number | null
        shares_count: number | null
        viewer_reaction: string | null
        viewer_saved: boolean | null
        viewer_follows_owner: boolean | null
        owner_identity_masked: boolean | null
      }
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {},
  },
} as const

