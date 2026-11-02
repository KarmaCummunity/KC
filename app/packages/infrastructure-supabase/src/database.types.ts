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
      about_team_members: {
        Row: {
          created_at: string
          is_active: boolean
          role_key: string
          sort_order: number
          user_id: string
        }
        Insert: {
          created_at?: string
          is_active?: boolean
          role_key: string
          sort_order?: number
          user_id: string
        }
        Update: {
          created_at?: string
          is_active?: boolean
          role_key?: string
          sort_order?: number
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "about_team_members_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "giving_user_trust_score"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "about_team_members_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "about_team_members_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users_public"
            referencedColumns: ["user_id"]
          },
        ]
      }
      admin_role_grants: {
        Row: {
          grant_id: string
          granted_at: string
          granted_by: string | null
          manager_grant_id: string | null
          revoked_at: string | null
          revoked_by: string | null
          role: string
          scope_org_id: string | null
          user_id: string
        }
        Insert: {
          grant_id?: string
          granted_at?: string
          granted_by?: string | null
          manager_grant_id?: string | null
          revoked_at?: string | null
          revoked_by?: string | null
          role: string
          scope_org_id?: string | null
          user_id: string
        }
        Update: {
          grant_id?: string
          granted_at?: string
          granted_by?: string | null
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
            isOneToOne: false
            referencedRelation: "giving_user_trust_score"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "admin_role_grants_granted_by_fkey"
            columns: ["granted_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "admin_role_grants_granted_by_fkey"
            columns: ["granted_by"]
            isOneToOne: false
            referencedRelation: "users_public"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "admin_role_grants_manager_grant_id_fkey"
            columns: ["manager_grant_id"]
            isOneToOne: false
            referencedRelation: "admin_role_grants"
            referencedColumns: ["grant_id"]
          },
          {
            foreignKeyName: "admin_role_grants_revoked_by_fkey"
            columns: ["revoked_by"]
            isOneToOne: false
            referencedRelation: "giving_user_trust_score"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "admin_role_grants_revoked_by_fkey"
            columns: ["revoked_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "admin_role_grants_revoked_by_fkey"
            columns: ["revoked_by"]
            isOneToOne: false
            referencedRelation: "users_public"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "admin_role_grants_scope_org_fk"
            columns: ["scope_org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["org_id"]
          },
          {
            foreignKeyName: "admin_role_grants_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "giving_user_trust_score"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "admin_role_grants_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "admin_role_grants_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users_public"
            referencedColumns: ["user_id"]
          },
        ]
      }
      admin_task_activities: {
        Row: {
          activity_id: string
          actor_id: string | null
          created_at: string
          kind: string
          payload: Json
          task_id: string
        }
        Insert: {
          activity_id?: string
          actor_id?: string | null
          created_at?: string
          kind: string
          payload?: Json
          task_id: string
        }
        Update: {
          activity_id?: string
          actor_id?: string | null
          created_at?: string
          kind?: string
          payload?: Json
          task_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "admin_task_activities_actor_id_fkey"
            columns: ["actor_id"]
            isOneToOne: false
            referencedRelation: "giving_user_trust_score"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "admin_task_activities_actor_id_fkey"
            columns: ["actor_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "admin_task_activities_actor_id_fkey"
            columns: ["actor_id"]
            isOneToOne: false
            referencedRelation: "users_public"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "admin_task_activities_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "admin_tasks"
            referencedColumns: ["task_id"]
          },
        ]
      }
      admin_tasks: {
        Row: {
          assignee_id: string | null
          category: string
          created_at: string
          created_by: string
          description: string | null
          due_at: string | null
          labels: string[]
          priority: string
          status: string
          task_id: string
          title: string
          updated_at: string
        }
        Insert: {
          assignee_id?: string | null
          category?: string
          created_at?: string
          created_by: string
          description?: string | null
          due_at?: string | null
          labels?: string[]
          priority?: string
          status?: string
          task_id?: string
          title: string
          updated_at?: string
        }
        Update: {
          assignee_id?: string | null
          category?: string
          created_at?: string
          created_by?: string
          description?: string | null
          due_at?: string | null
          labels?: string[]
          priority?: string
          status?: string
          task_id?: string
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "admin_tasks_assignee_id_fkey"
            columns: ["assignee_id"]
            isOneToOne: false
            referencedRelation: "giving_user_trust_score"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "admin_tasks_assignee_id_fkey"
            columns: ["assignee_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "admin_tasks_assignee_id_fkey"
            columns: ["assignee_id"]
            isOneToOne: false
            referencedRelation: "users_public"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "admin_tasks_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "giving_user_trust_score"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "admin_tasks_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "admin_tasks_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users_public"
            referencedColumns: ["user_id"]
          },
        ]
      }
      app_flags: {
        Row: {
          description: string | null
          enabled: boolean
          key: string
          updated_at: string
        }
        Insert: {
          description?: string | null
          enabled?: boolean
          key: string
          updated_at?: string
        }
        Update: {
          description?: string | null
          enabled?: boolean
          key?: string
          updated_at?: string
        }
        Relationships: []
      }
      audit_events: {
        Row: {
          action: string
          actor_id: string | null
          created_at: string
          event_id: string
          metadata: Json | null
          target_id: string | null
          target_type: string | null
        }
        Insert: {
          action: string
          actor_id?: string | null
          created_at?: string
          event_id?: string
          metadata?: Json | null
          target_id?: string | null
          target_type?: string | null
        }
        Update: {
          action?: string
          actor_id?: string | null
          created_at?: string
          event_id?: string
          metadata?: Json | null
          target_id?: string | null
          target_type?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "audit_events_actor_id_fkey"
            columns: ["actor_id"]
            isOneToOne: false
            referencedRelation: "giving_user_trust_score"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "audit_events_actor_id_fkey"
            columns: ["actor_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "audit_events_actor_id_fkey"
            columns: ["actor_id"]
            isOneToOne: false
            referencedRelation: "users_public"
            referencedColumns: ["user_id"]
          },
        ]
      }
      auth_identities: {
        Row: {
          auth_identity_id: string
          created_at: string
          provider: string
          provider_subject: string
          user_id: string
        }
        Insert: {
          auth_identity_id?: string
          created_at?: string
          provider: string
          provider_subject: string
          user_id: string
        }
        Update: {
          auth_identity_id?: string
          created_at?: string
          provider?: string
          provider_subject?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "auth_identities_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "giving_user_trust_score"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "auth_identities_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "auth_identities_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users_public"
            referencedColumns: ["user_id"]
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
            isOneToOne: false
            referencedRelation: "giving_user_trust_score"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "blocks_blocked_id_fkey"
            columns: ["blocked_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "blocks_blocked_id_fkey"
            columns: ["blocked_id"]
            isOneToOne: false
            referencedRelation: "users_public"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "blocks_blocker_id_fkey"
            columns: ["blocker_id"]
            isOneToOne: false
            referencedRelation: "giving_user_trust_score"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "blocks_blocker_id_fkey"
            columns: ["blocker_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "blocks_blocker_id_fkey"
            columns: ["blocker_id"]
            isOneToOne: false
            referencedRelation: "users_public"
            referencedColumns: ["user_id"]
          },
        ]
      }
      bot_admin_review_items: {
        Row: {
          created_at: string
          extraction_id: string | null
          listing_id: string | null
          reason: string
          resolved_at: string | null
          review_id: string
          reviewer_id: string | null
          status: string
        }
        Insert: {
          created_at?: string
          extraction_id?: string | null
          listing_id?: string | null
          reason: string
          resolved_at?: string | null
          review_id?: string
          reviewer_id?: string | null
          status?: string
        }
        Update: {
          created_at?: string
          extraction_id?: string | null
          listing_id?: string | null
          reason?: string
          resolved_at?: string | null
          review_id?: string
          reviewer_id?: string | null
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "bot_admin_review_items_extraction_id_fkey"
            columns: ["extraction_id"]
            isOneToOne: false
            referencedRelation: "extractions"
            referencedColumns: ["extraction_id"]
          },
          {
            foreignKeyName: "bot_admin_review_items_listing_id_fkey"
            columns: ["listing_id"]
            isOneToOne: false
            referencedRelation: "listings"
            referencedColumns: ["listing_id"]
          },
          {
            foreignKeyName: "bot_admin_review_items_listing_id_fkey"
            columns: ["listing_id"]
            isOneToOne: false
            referencedRelation: "marketplace_listing_card"
            referencedColumns: ["listing_id"]
          },
          {
            foreignKeyName: "bot_admin_review_items_reviewer_id_fkey"
            columns: ["reviewer_id"]
            isOneToOne: false
            referencedRelation: "giving_user_trust_score"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "bot_admin_review_items_reviewer_id_fkey"
            columns: ["reviewer_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "bot_admin_review_items_reviewer_id_fkey"
            columns: ["reviewer_id"]
            isOneToOne: false
            referencedRelation: "users_public"
            referencedColumns: ["user_id"]
          },
        ]
      }
      bot_conversation_sessions: {
        Row: {
          created_at: string
          draft: Json
          extraction_id: string | null
          identity_id: string
          listing_id: string | null
          record_id: string | null
          session_id: string
          state: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          draft?: Json
          extraction_id?: string | null
          identity_id: string
          listing_id?: string | null
          record_id?: string | null
          session_id?: string
          state?: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          draft?: Json
          extraction_id?: string | null
          identity_id?: string
          listing_id?: string | null
          record_id?: string | null
          session_id?: string
          state?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "bot_conversation_sessions_extraction_id_fkey"
            columns: ["extraction_id"]
            isOneToOne: false
            referencedRelation: "extractions"
            referencedColumns: ["extraction_id"]
          },
          {
            foreignKeyName: "bot_conversation_sessions_identity_id_fkey"
            columns: ["identity_id"]
            isOneToOne: false
            referencedRelation: "whatsapp_identities"
            referencedColumns: ["identity_id"]
          },
          {
            foreignKeyName: "bot_conversation_sessions_listing_id_fkey"
            columns: ["listing_id"]
            isOneToOne: false
            referencedRelation: "listings"
            referencedColumns: ["listing_id"]
          },
          {
            foreignKeyName: "bot_conversation_sessions_listing_id_fkey"
            columns: ["listing_id"]
            isOneToOne: false
            referencedRelation: "marketplace_listing_card"
            referencedColumns: ["listing_id"]
          },
          {
            foreignKeyName: "bot_conversation_sessions_record_id_fkey"
            columns: ["record_id"]
            isOneToOne: false
            referencedRelation: "raw_records"
            referencedColumns: ["record_id"]
          },
        ]
      }
      bot_match_responses: {
        Row: {
          created_at: string
          match_id: string
          response: string
          response_id: string
          user_id: string
        }
        Insert: {
          created_at?: string
          match_id: string
          response: string
          response_id?: string
          user_id: string
        }
        Update: {
          created_at?: string
          match_id?: string
          response?: string
          response_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "bot_match_responses_match_id_fkey"
            columns: ["match_id"]
            isOneToOne: false
            referencedRelation: "listing_matches"
            referencedColumns: ["match_id"]
          },
          {
            foreignKeyName: "bot_match_responses_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "giving_user_trust_score"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "bot_match_responses_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "bot_match_responses_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users_public"
            referencedColumns: ["user_id"]
          },
        ]
      }
      bot_outbound_messages: {
        Row: {
          attempts: number
          body: string | null
          channel: string
          claimed_at: string | null
          created_at: string
          kind: string
          language: string
          last_error: string | null
          next_attempt_at: string
          outbound_id: string
          payload: Json
          queue_msg_id: number | null
          sent_at: string | null
          status: string
          template_name: string | null
          to_wa_id: string | null
          user_id: string | null
          wa_message_id: string | null
        }
        Insert: {
          attempts?: number
          body?: string | null
          channel?: string
          claimed_at?: string | null
          created_at?: string
          kind?: string
          language?: string
          last_error?: string | null
          next_attempt_at?: string
          outbound_id?: string
          payload?: Json
          queue_msg_id?: number | null
          sent_at?: string | null
          status?: string
          template_name?: string | null
          to_wa_id?: string | null
          user_id?: string | null
          wa_message_id?: string | null
        }
        Update: {
          attempts?: number
          body?: string | null
          channel?: string
          claimed_at?: string | null
          created_at?: string
          kind?: string
          language?: string
          last_error?: string | null
          next_attempt_at?: string
          outbound_id?: string
          payload?: Json
          queue_msg_id?: number | null
          sent_at?: string | null
          status?: string
          template_name?: string | null
          to_wa_id?: string | null
          user_id?: string | null
          wa_message_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "bot_outbound_messages_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "giving_user_trust_score"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "bot_outbound_messages_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "bot_outbound_messages_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users_public"
            referencedColumns: ["user_id"]
          },
        ]
      }
      categories: {
        Row: {
          category_id: string
          created_at: string
          is_active: boolean
          label_en: string | null
          label_he: string
          legacy_donation_slug: string | null
          legacy_post_category: string | null
          parent_id: string | null
          slug: string
          sort_order: number
          world_slug: string
        }
        Insert: {
          category_id?: string
          created_at?: string
          is_active?: boolean
          label_en?: string | null
          label_he: string
          legacy_donation_slug?: string | null
          legacy_post_category?: string | null
          parent_id?: string | null
          slug: string
          sort_order?: number
          world_slug: string
        }
        Update: {
          category_id?: string
          created_at?: string
          is_active?: boolean
          label_en?: string | null
          label_he?: string
          legacy_donation_slug?: string | null
          legacy_post_category?: string | null
          parent_id?: string | null
          slug?: string
          sort_order?: number
          world_slug?: string
        }
        Relationships: [
          {
            foreignKeyName: "categories_legacy_donation_slug_fkey"
            columns: ["legacy_donation_slug"]
            isOneToOne: false
            referencedRelation: "donation_categories"
            referencedColumns: ["slug"]
          },
          {
            foreignKeyName: "categories_parent_id_fkey"
            columns: ["parent_id"]
            isOneToOne: false
            referencedRelation: "categories"
            referencedColumns: ["category_id"]
          },
          {
            foreignKeyName: "categories_world_slug_fkey"
            columns: ["world_slug"]
            isOneToOne: false
            referencedRelation: "worlds"
            referencedColumns: ["slug"]
          },
        ]
      }
      chats: {
        Row: {
          anchor_listing_id: string | null
          anchor_post_id: string | null
          anchor_ride_id: string | null
          chat_id: string
          created_at: string
          inbox_hidden_at_a: string | null
          inbox_hidden_at_b: string | null
          is_support_thread: boolean
          last_message_at: string
          participant_a: string | null
          participant_b: string | null
          removed_at: string | null
        }
        Insert: {
          anchor_listing_id?: string | null
          anchor_post_id?: string | null
          anchor_ride_id?: string | null
          chat_id?: string
          created_at?: string
          inbox_hidden_at_a?: string | null
          inbox_hidden_at_b?: string | null
          is_support_thread?: boolean
          last_message_at?: string
          participant_a?: string | null
          participant_b?: string | null
          removed_at?: string | null
        }
        Update: {
          anchor_listing_id?: string | null
          anchor_post_id?: string | null
          anchor_ride_id?: string | null
          chat_id?: string
          created_at?: string
          inbox_hidden_at_a?: string | null
          inbox_hidden_at_b?: string | null
          is_support_thread?: boolean
          last_message_at?: string
          participant_a?: string | null
          participant_b?: string | null
          removed_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "chats_anchor_listing_id_fkey"
            columns: ["anchor_listing_id"]
            isOneToOne: false
            referencedRelation: "listings"
            referencedColumns: ["listing_id"]
          },
          {
            foreignKeyName: "chats_anchor_listing_id_fkey"
            columns: ["anchor_listing_id"]
            isOneToOne: false
            referencedRelation: "marketplace_listing_card"
            referencedColumns: ["listing_id"]
          },
          {
            foreignKeyName: "chats_anchor_post_id_fkey"
            columns: ["anchor_post_id"]
            isOneToOne: false
            referencedRelation: "feed_visible_posts"
            referencedColumns: ["post_id"]
          },
          {
            foreignKeyName: "chats_anchor_post_id_fkey"
            columns: ["anchor_post_id"]
            isOneToOne: false
            referencedRelation: "posts"
            referencedColumns: ["post_id"]
          },
          {
            foreignKeyName: "chats_anchor_ride_id_fkey"
            columns: ["anchor_ride_id"]
            isOneToOne: false
            referencedRelation: "ride_listings"
            referencedColumns: ["ride_id"]
          },
          {
            foreignKeyName: "chats_participant_a_fkey"
            columns: ["participant_a"]
            isOneToOne: false
            referencedRelation: "giving_user_trust_score"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "chats_participant_a_fkey"
            columns: ["participant_a"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "chats_participant_a_fkey"
            columns: ["participant_a"]
            isOneToOne: false
            referencedRelation: "users_public"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "chats_participant_b_fkey"
            columns: ["participant_b"]
            isOneToOne: false
            referencedRelation: "giving_user_trust_score"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "chats_participant_b_fkey"
            columns: ["participant_b"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "chats_participant_b_fkey"
            columns: ["participant_b"]
            isOneToOne: false
            referencedRelation: "users_public"
            referencedColumns: ["user_id"]
          },
        ]
      }
      cities: {
        Row: {
          city_id: string
          country_code: string
          geo: unknown
          lat: number | null
          lon: number | null
          name_en: string
          name_he: string
        }
        Insert: {
          city_id: string
          country_code?: string
          geo?: unknown
          lat?: number | null
          lon?: number | null
          name_en: string
          name_he: string
        }
        Update: {
          city_id?: string
          country_code?: string
          geo?: unknown
          lat?: number | null
          lon?: number | null
          name_en?: string
          name_he?: string
        }
        Relationships: []
      }
      claim_requests: {
        Row: {
          claim_id: string
          created_at: string
          listing_id: string
          requester_id: string
          status: string
        }
        Insert: {
          claim_id?: string
          created_at?: string
          listing_id: string
          requester_id: string
          status?: string
        }
        Update: {
          claim_id?: string
          created_at?: string
          listing_id?: string
          requester_id?: string
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "claim_requests_listing_id_fkey"
            columns: ["listing_id"]
            isOneToOne: false
            referencedRelation: "listings"
            referencedColumns: ["listing_id"]
          },
          {
            foreignKeyName: "claim_requests_listing_id_fkey"
            columns: ["listing_id"]
            isOneToOne: false
            referencedRelation: "marketplace_listing_card"
            referencedColumns: ["listing_id"]
          },
          {
            foreignKeyName: "claim_requests_requester_id_fkey"
            columns: ["requester_id"]
            isOneToOne: false
            referencedRelation: "giving_user_trust_score"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "claim_requests_requester_id_fkey"
            columns: ["requester_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "claim_requests_requester_id_fkey"
            columns: ["requester_id"]
            isOneToOne: false
            referencedRelation: "users_public"
            referencedColumns: ["user_id"]
          },
        ]
      }
      closure_cleanup_metrics: {
        Row: {
          deleted_count: number
          run_at: string
        }
        Insert: {
          deleted_count: number
          run_at?: string
        }
        Update: {
          deleted_count?: number
          run_at?: string
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
          id: string
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
          id?: string
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
          id?: string
          model?: string | null
          source_language?: string | null
          target_language?: string
          translated_text?: string
        }
        Relationships: []
      }
      crm_contacts: {
        Row: {
          contact_id: string
          created_at: string
          created_by: string | null
          deleted_at: string | null
          email: string | null
          last_contacted_at: string | null
          name: string
          notes: string | null
          organization: string | null
          phone: string | null
          role_title: string | null
          status: string
          tags: string[]
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          contact_id?: string
          created_at?: string
          created_by?: string | null
          deleted_at?: string | null
          email?: string | null
          last_contacted_at?: string | null
          name: string
          notes?: string | null
          organization?: string | null
          phone?: string | null
          role_title?: string | null
          status?: string
          tags?: string[]
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          contact_id?: string
          created_at?: string
          created_by?: string | null
          deleted_at?: string | null
          email?: string | null
          last_contacted_at?: string | null
          name?: string
          notes?: string | null
          organization?: string | null
          phone?: string | null
          role_title?: string | null
          status?: string
          tags?: string[]
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "crm_contacts_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "giving_user_trust_score"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "crm_contacts_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "crm_contacts_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users_public"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "crm_contacts_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "giving_user_trust_score"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "crm_contacts_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "crm_contacts_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "users_public"
            referencedColumns: ["user_id"]
          },
        ]
      }
      devices: {
        Row: {
          active: boolean
          device_id: string
          last_seen_at: string
          platform: string
          push_token: string
          user_id: string
        }
        Insert: {
          active?: boolean
          device_id?: string
          last_seen_at?: string
          platform: string
          push_token: string
          user_id: string
        }
        Update: {
          active?: boolean
          device_id?: string
          last_seen_at?: string
          platform?: string
          push_token?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "devices_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "giving_user_trust_score"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "devices_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "devices_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users_public"
            referencedColumns: ["user_id"]
          },
        ]
      }
      donation_categories: {
        Row: {
          icon_name: string
          is_active: boolean
          label_he: string
          slug: string
          sort_order: number
        }
        Insert: {
          icon_name: string
          is_active?: boolean
          label_he: string
          slug: string
          sort_order: number
        }
        Update: {
          icon_name?: string
          is_active?: boolean
          label_he?: string
          slug?: string
          sort_order?: number
        }
        Relationships: []
      }
      donation_intents: {
        Row: {
          amount_ils: number
          checkout_url: string | null
          created_at: string
          currency: string
          idempotency_key: string
          intent_id: string
          listing_id: string | null
          org_id: string
          provider_id: string | null
          provider_ref: string | null
          status: string
          updated_at: string
          user_id: string | null
        }
        Insert: {
          amount_ils: number
          checkout_url?: string | null
          created_at?: string
          currency?: string
          idempotency_key: string
          intent_id?: string
          listing_id?: string | null
          org_id: string
          provider_id?: string | null
          provider_ref?: string | null
          status?: string
          updated_at?: string
          user_id?: string | null
        }
        Update: {
          amount_ils?: number
          checkout_url?: string | null
          created_at?: string
          currency?: string
          idempotency_key?: string
          intent_id?: string
          listing_id?: string | null
          org_id?: string
          provider_id?: string | null
          provider_ref?: string | null
          status?: string
          updated_at?: string
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "donation_intents_listing_id_fkey"
            columns: ["listing_id"]
            isOneToOne: false
            referencedRelation: "listings"
            referencedColumns: ["listing_id"]
          },
          {
            foreignKeyName: "donation_intents_listing_id_fkey"
            columns: ["listing_id"]
            isOneToOne: false
            referencedRelation: "marketplace_listing_card"
            referencedColumns: ["listing_id"]
          },
          {
            foreignKeyName: "donation_intents_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["org_id"]
          },
          {
            foreignKeyName: "donation_intents_provider_id_fkey"
            columns: ["provider_id"]
            isOneToOne: false
            referencedRelation: "payment_providers"
            referencedColumns: ["provider_id"]
          },
          {
            foreignKeyName: "donation_intents_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "giving_user_trust_score"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "donation_intents_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "donation_intents_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users_public"
            referencedColumns: ["user_id"]
          },
        ]
      }
      donation_links: {
        Row: {
          category_slug: string
          created_at: string
          description: string | null
          display_name: string
          hidden_at: string | null
          hidden_by: string | null
          id: string
          search_vector: unknown
          submitted_by: string
          tags: string | null
          url: string
          validated_at: string
        }
        Insert: {
          category_slug: string
          created_at?: string
          description?: string | null
          display_name: string
          hidden_at?: string | null
          hidden_by?: string | null
          id?: string
          search_vector?: unknown
          submitted_by: string
          tags?: string | null
          url: string
          validated_at: string
        }
        Update: {
          category_slug?: string
          created_at?: string
          description?: string | null
          display_name?: string
          hidden_at?: string | null
          hidden_by?: string | null
          id?: string
          search_vector?: unknown
          submitted_by?: string
          tags?: string | null
          url?: string
          validated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "donation_links_category_slug_fkey"
            columns: ["category_slug"]
            isOneToOne: false
            referencedRelation: "donation_categories"
            referencedColumns: ["slug"]
          },
        ]
      }
      donation_receipts: {
        Row: {
          issued_at: string
          org_id: string
          payload: Json
          payment_id: string
          receipt_id: string
          section46_serial: string | null
          user_id: string | null
        }
        Insert: {
          issued_at?: string
          org_id: string
          payload?: Json
          payment_id: string
          receipt_id?: string
          section46_serial?: string | null
          user_id?: string | null
        }
        Update: {
          issued_at?: string
          org_id?: string
          payload?: Json
          payment_id?: string
          receipt_id?: string
          section46_serial?: string | null
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "donation_receipts_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["org_id"]
          },
          {
            foreignKeyName: "donation_receipts_payment_id_fkey"
            columns: ["payment_id"]
            isOneToOne: true
            referencedRelation: "payments"
            referencedColumns: ["payment_id"]
          },
          {
            foreignKeyName: "donation_receipts_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "giving_user_trust_score"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "donation_receipts_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "donation_receipts_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users_public"
            referencedColumns: ["user_id"]
          },
        ]
      }
      driver_declarations: {
        Row: {
          declared_at: string
          insurance_declared: boolean
          license_declared: boolean
          no_profit_acknowledged: boolean
          user_id: string
        }
        Insert: {
          declared_at?: string
          insurance_declared: boolean
          license_declared: boolean
          no_profit_acknowledged: boolean
          user_id: string
        }
        Update: {
          declared_at?: string
          insurance_declared?: boolean
          license_declared?: boolean
          no_profit_acknowledged?: boolean
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "driver_declarations_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: true
            referencedRelation: "giving_user_trust_score"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "driver_declarations_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: true
            referencedRelation: "users"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "driver_declarations_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: true
            referencedRelation: "users_public"
            referencedColumns: ["user_id"]
          },
        ]
      }
      embedding_jobs: {
        Row: {
          attempts: number
          created_at: string
          error_message: string | null
          job_id: string
          listing_id: string
          model: string
          status: string
          updated_at: string
        }
        Insert: {
          attempts?: number
          created_at?: string
          error_message?: string | null
          job_id?: string
          listing_id: string
          model?: string
          status?: string
          updated_at?: string
        }
        Update: {
          attempts?: number
          created_at?: string
          error_message?: string | null
          job_id?: string
          listing_id?: string
          model?: string
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "embedding_jobs_listing_id_fkey"
            columns: ["listing_id"]
            isOneToOne: true
            referencedRelation: "listings"
            referencedColumns: ["listing_id"]
          },
          {
            foreignKeyName: "embedding_jobs_listing_id_fkey"
            columns: ["listing_id"]
            isOneToOne: true
            referencedRelation: "marketplace_listing_card"
            referencedColumns: ["listing_id"]
          },
        ]
      }
      entity_aliases: {
        Row: {
          actor_id: string
          alias_id: string
          alias_text: string
          created_at: string
          source: string | null
        }
        Insert: {
          actor_id: string
          alias_id?: string
          alias_text: string
          created_at?: string
          source?: string | null
        }
        Update: {
          actor_id?: string
          alias_id?: string
          alias_text?: string
          created_at?: string
          source?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "entity_aliases_actor_id_fkey"
            columns: ["actor_id"]
            isOneToOne: false
            referencedRelation: "marketplace_actors"
            referencedColumns: ["actor_id"]
          },
        ]
      }
      entity_merges: {
        Row: {
          merge_id: string
          merged_at: string
          merged_by: string | null
          merged_id: string
          snapshot: Json
          survivor_id: string
          undone_at: string | null
          undone_by: string | null
        }
        Insert: {
          merge_id?: string
          merged_at?: string
          merged_by?: string | null
          merged_id: string
          snapshot: Json
          survivor_id: string
          undone_at?: string | null
          undone_by?: string | null
        }
        Update: {
          merge_id?: string
          merged_at?: string
          merged_by?: string | null
          merged_id?: string
          snapshot?: Json
          survivor_id?: string
          undone_at?: string | null
          undone_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "entity_merges_merged_by_fkey"
            columns: ["merged_by"]
            isOneToOne: false
            referencedRelation: "giving_user_trust_score"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "entity_merges_merged_by_fkey"
            columns: ["merged_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "entity_merges_merged_by_fkey"
            columns: ["merged_by"]
            isOneToOne: false
            referencedRelation: "users_public"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "entity_merges_merged_id_fkey"
            columns: ["merged_id"]
            isOneToOne: false
            referencedRelation: "marketplace_actors"
            referencedColumns: ["actor_id"]
          },
          {
            foreignKeyName: "entity_merges_survivor_id_fkey"
            columns: ["survivor_id"]
            isOneToOne: false
            referencedRelation: "marketplace_actors"
            referencedColumns: ["actor_id"]
          },
          {
            foreignKeyName: "entity_merges_undone_by_fkey"
            columns: ["undone_by"]
            isOneToOne: false
            referencedRelation: "giving_user_trust_score"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "entity_merges_undone_by_fkey"
            columns: ["undone_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "entity_merges_undone_by_fkey"
            columns: ["undone_by"]
            isOneToOne: false
            referencedRelation: "users_public"
            referencedColumns: ["user_id"]
          },
        ]
      }
      er_candidates: {
        Row: {
          actor_a: string
          actor_b: string
          candidate_id: string
          created_at: string
          reason: string | null
          score: number
          status: string
        }
        Insert: {
          actor_a: string
          actor_b: string
          candidate_id?: string
          created_at?: string
          reason?: string | null
          score: number
          status?: string
        }
        Update: {
          actor_a?: string
          actor_b?: string
          candidate_id?: string
          created_at?: string
          reason?: string | null
          score?: number
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "er_candidates_actor_a_fkey"
            columns: ["actor_a"]
            isOneToOne: false
            referencedRelation: "marketplace_actors"
            referencedColumns: ["actor_id"]
          },
          {
            foreignKeyName: "er_candidates_actor_b_fkey"
            columns: ["actor_b"]
            isOneToOne: false
            referencedRelation: "marketplace_actors"
            referencedColumns: ["actor_id"]
          },
        ]
      }
      external_bodies: {
        Row: {
          body_id: string
          body_type: string
          contact_url: string | null
          created_at: string
          is_active: boolean
          is_verified: boolean
          label_en: string
          label_he: string
          requires_routing: boolean
          slug: string
          world_slug: string
        }
        Insert: {
          body_id?: string
          body_type: string
          contact_url?: string | null
          created_at?: string
          is_active?: boolean
          is_verified?: boolean
          label_en: string
          label_he: string
          requires_routing?: boolean
          slug: string
          world_slug: string
        }
        Update: {
          body_id?: string
          body_type?: string
          contact_url?: string | null
          created_at?: string
          is_active?: boolean
          is_verified?: boolean
          label_en?: string
          label_he?: string
          requires_routing?: boolean
          slug?: string
          world_slug?: string
        }
        Relationships: [
          {
            foreignKeyName: "external_bodies_world_slug_fkey"
            columns: ["world_slug"]
            isOneToOne: false
            referencedRelation: "worlds"
            referencedColumns: ["slug"]
          },
        ]
      }
      extractions: {
        Row: {
          confidence: number | null
          created_at: string
          extracted: Json
          extraction_id: string
          kind_slug: string | null
          listing_id: string | null
          record_id: string
          world_slug: string | null
        }
        Insert: {
          confidence?: number | null
          created_at?: string
          extracted?: Json
          extraction_id?: string
          kind_slug?: string | null
          listing_id?: string | null
          record_id: string
          world_slug?: string | null
        }
        Update: {
          confidence?: number | null
          created_at?: string
          extracted?: Json
          extraction_id?: string
          kind_slug?: string | null
          listing_id?: string | null
          record_id?: string
          world_slug?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "extractions_listing_id_fkey"
            columns: ["listing_id"]
            isOneToOne: false
            referencedRelation: "listings"
            referencedColumns: ["listing_id"]
          },
          {
            foreignKeyName: "extractions_listing_id_fkey"
            columns: ["listing_id"]
            isOneToOne: false
            referencedRelation: "marketplace_listing_card"
            referencedColumns: ["listing_id"]
          },
          {
            foreignKeyName: "extractions_record_id_fkey"
            columns: ["record_id"]
            isOneToOne: false
            referencedRelation: "raw_records"
            referencedColumns: ["record_id"]
          },
          {
            foreignKeyName: "extractions_world_slug_fkey"
            columns: ["world_slug"]
            isOneToOne: false
            referencedRelation: "worlds"
            referencedColumns: ["slug"]
          },
        ]
      }
      feed_impressions: {
        Row: {
          impression_id: string
          post_id: string
          seen_at: string
          user_id: string
        }
        Insert: {
          impression_id?: string
          post_id: string
          seen_at?: string
          user_id: string
        }
        Update: {
          impression_id?: string
          post_id?: string
          seen_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "feed_impressions_post_id_fkey"
            columns: ["post_id"]
            isOneToOne: false
            referencedRelation: "feed_visible_posts"
            referencedColumns: ["post_id"]
          },
          {
            foreignKeyName: "feed_impressions_post_id_fkey"
            columns: ["post_id"]
            isOneToOne: false
            referencedRelation: "posts"
            referencedColumns: ["post_id"]
          },
          {
            foreignKeyName: "feed_impressions_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "giving_user_trust_score"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "feed_impressions_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "feed_impressions_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users_public"
            referencedColumns: ["user_id"]
          },
        ]
      }
      feed_impressions_default: {
        Row: {
          impression_id: string
          post_id: string
          seen_at: string
          user_id: string
        }
        Insert: {
          impression_id?: string
          post_id: string
          seen_at?: string
          user_id: string
        }
        Update: {
          impression_id?: string
          post_id?: string
          seen_at?: string
          user_id?: string
        }
        Relationships: []
      }
      feed_mute_filters: {
        Row: {
          created_at: string
          filter_id: string
          filter_kind: string
          filter_value: string
          user_id: string
        }
        Insert: {
          created_at?: string
          filter_id?: string
          filter_kind: string
          filter_value: string
          user_id: string
        }
        Update: {
          created_at?: string
          filter_id?: string
          filter_kind?: string
          filter_value?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "feed_mute_filters_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "giving_user_trust_score"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "feed_mute_filters_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "feed_mute_filters_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users_public"
            referencedColumns: ["user_id"]
          },
        ]
      }
      feed_mv_refresh_state: {
        Row: {
          dirty: boolean
          last_refresh_at: string | null
          row_count: number
          singleton_id: number
          updated_at: string
        }
        Insert: {
          dirty?: boolean
          last_refresh_at?: string | null
          row_count?: number
          singleton_id?: number
          updated_at?: string
        }
        Update: {
          dirty?: boolean
          last_refresh_at?: string | null
          row_count?: number
          singleton_id?: number
          updated_at?: string
        }
        Relationships: []
      }
      feed_post_hides: {
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
            foreignKeyName: "feed_post_hides_post_id_fkey"
            columns: ["post_id"]
            isOneToOne: false
            referencedRelation: "feed_visible_posts"
            referencedColumns: ["post_id"]
          },
          {
            foreignKeyName: "feed_post_hides_post_id_fkey"
            columns: ["post_id"]
            isOneToOne: false
            referencedRelation: "posts"
            referencedColumns: ["post_id"]
          },
          {
            foreignKeyName: "feed_post_hides_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "giving_user_trust_score"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "feed_post_hides_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "feed_post_hides_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users_public"
            referencedColumns: ["user_id"]
          },
        ]
      }
      feed_ranking_config: {
        Row: {
          config_key: string
          updated_at: string
          weight: number
        }
        Insert: {
          config_key: string
          updated_at?: string
          weight: number
        }
        Update: {
          config_key?: string
          updated_at?: string
          weight?: number
        }
        Relationships: []
      }
      field_provenance: {
        Row: {
          extracted_at: string
          field_path: string
          listing_id: string
          provenance_id: string
          record_id: string | null
          source_id: string | null
        }
        Insert: {
          extracted_at?: string
          field_path: string
          listing_id: string
          provenance_id?: string
          record_id?: string | null
          source_id?: string | null
        }
        Update: {
          extracted_at?: string
          field_path?: string
          listing_id?: string
          provenance_id?: string
          record_id?: string | null
          source_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "field_provenance_listing_id_fkey"
            columns: ["listing_id"]
            isOneToOne: false
            referencedRelation: "listings"
            referencedColumns: ["listing_id"]
          },
          {
            foreignKeyName: "field_provenance_listing_id_fkey"
            columns: ["listing_id"]
            isOneToOne: false
            referencedRelation: "marketplace_listing_card"
            referencedColumns: ["listing_id"]
          },
          {
            foreignKeyName: "field_provenance_record_id_fkey"
            columns: ["record_id"]
            isOneToOne: false
            referencedRelation: "raw_records"
            referencedColumns: ["record_id"]
          },
          {
            foreignKeyName: "field_provenance_source_id_fkey"
            columns: ["source_id"]
            isOneToOne: false
            referencedRelation: "ingestion_sources"
            referencedColumns: ["source_id"]
          },
        ]
      }
      finance_ledger_entries: {
        Row: {
          amount_cents: number
          category: string | null
          counterparty: string | null
          created_at: string
          created_by: string | null
          currency: string
          deleted_at: string | null
          description: string | null
          direction: string
          entry_id: string
          kind: string
          occurred_at: string
          reference_url: string | null
          status: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          amount_cents: number
          category?: string | null
          counterparty?: string | null
          created_at?: string
          created_by?: string | null
          currency?: string
          deleted_at?: string | null
          description?: string | null
          direction: string
          entry_id?: string
          kind: string
          occurred_at?: string
          reference_url?: string | null
          status?: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          amount_cents?: number
          category?: string | null
          counterparty?: string | null
          created_at?: string
          created_by?: string | null
          currency?: string
          deleted_at?: string | null
          description?: string | null
          direction?: string
          entry_id?: string
          kind?: string
          occurred_at?: string
          reference_url?: string | null
          status?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "finance_ledger_entries_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "giving_user_trust_score"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "finance_ledger_entries_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "finance_ledger_entries_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "users_public"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "finance_ledger_entries_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "giving_user_trust_score"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "finance_ledger_entries_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "finance_ledger_entries_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "users_public"
            referencedColumns: ["user_id"]
          },
        ]
      }
      follow_edges: {
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
            foreignKeyName: "follow_edges_followed_id_fkey"
            columns: ["followed_id"]
            isOneToOne: false
            referencedRelation: "giving_user_trust_score"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "follow_edges_followed_id_fkey"
            columns: ["followed_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "follow_edges_followed_id_fkey"
            columns: ["followed_id"]
            isOneToOne: false
            referencedRelation: "users_public"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "follow_edges_follower_id_fkey"
            columns: ["follower_id"]
            isOneToOne: false
            referencedRelation: "giving_user_trust_score"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "follow_edges_follower_id_fkey"
            columns: ["follower_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "follow_edges_follower_id_fkey"
            columns: ["follower_id"]
            isOneToOne: false
            referencedRelation: "users_public"
            referencedColumns: ["user_id"]
          },
        ]
      }
      follow_requests: {
        Row: {
          cooldown_until: string | null
          created_at: string
          requester_id: string
          resolved_at: string | null
          status: string
          target_id: string
        }
        Insert: {
          cooldown_until?: string | null
          created_at?: string
          requester_id: string
          resolved_at?: string | null
          status?: string
          target_id: string
        }
        Update: {
          cooldown_until?: string | null
          created_at?: string
          requester_id?: string
          resolved_at?: string | null
          status?: string
          target_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "follow_requests_requester_id_fkey"
            columns: ["requester_id"]
            isOneToOne: false
            referencedRelation: "giving_user_trust_score"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "follow_requests_requester_id_fkey"
            columns: ["requester_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "follow_requests_requester_id_fkey"
            columns: ["requester_id"]
            isOneToOne: false
            referencedRelation: "users_public"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "follow_requests_target_id_fkey"
            columns: ["target_id"]
            isOneToOne: false
            referencedRelation: "giving_user_trust_score"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "follow_requests_target_id_fkey"
            columns: ["target_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "follow_requests_target_id_fkey"
            columns: ["target_id"]
            isOneToOne: false
            referencedRelation: "users_public"
            referencedColumns: ["user_id"]
          },
        ]
      }
      giving_handoff_ratings: {
        Row: {
          comment: string | null
          created_at: string
          handoff_id: string
          ratee_id: string
          rater_id: string
          rating: number
          rating_id: string
        }
        Insert: {
          comment?: string | null
          created_at?: string
          handoff_id: string
          ratee_id: string
          rater_id: string
          rating: number
          rating_id?: string
        }
        Update: {
          comment?: string | null
          created_at?: string
          handoff_id?: string
          ratee_id?: string
          rater_id?: string
          rating?: number
          rating_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "giving_handoff_ratings_handoff_id_fkey"
            columns: ["handoff_id"]
            isOneToOne: false
            referencedRelation: "giving_handoffs"
            referencedColumns: ["handoff_id"]
          },
          {
            foreignKeyName: "giving_handoff_ratings_ratee_id_fkey"
            columns: ["ratee_id"]
            isOneToOne: false
            referencedRelation: "giving_user_trust_score"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "giving_handoff_ratings_ratee_id_fkey"
            columns: ["ratee_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "giving_handoff_ratings_ratee_id_fkey"
            columns: ["ratee_id"]
            isOneToOne: false
            referencedRelation: "users_public"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "giving_handoff_ratings_rater_id_fkey"
            columns: ["rater_id"]
            isOneToOne: false
            referencedRelation: "giving_user_trust_score"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "giving_handoff_ratings_rater_id_fkey"
            columns: ["rater_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "giving_handoff_ratings_rater_id_fkey"
            columns: ["rater_id"]
            isOneToOne: false
            referencedRelation: "users_public"
            referencedColumns: ["user_id"]
          },
        ]
      }
      giving_handoffs: {
        Row: {
          cancel_reason: string | null
          cancelled_at: string | null
          confirm_by: string | null
          confirmed_at: string | null
          handed_over_at: string | null
          handoff_id: string
          listing_id: string
          no_show_at: string | null
          owner_id: string
          pickup_mode: string
          pickup_window_end: string | null
          pickup_window_start: string | null
          recipient_id: string
          reserved_at: string
          seats: number
          slot_ends_at: string | null
          slot_starts_at: string | null
          status: string
          world_slug: string
        }
        Insert: {
          cancel_reason?: string | null
          cancelled_at?: string | null
          confirm_by?: string | null
          confirmed_at?: string | null
          handed_over_at?: string | null
          handoff_id?: string
          listing_id: string
          no_show_at?: string | null
          owner_id: string
          pickup_mode?: string
          pickup_window_end?: string | null
          pickup_window_start?: string | null
          recipient_id: string
          reserved_at?: string
          seats?: number
          slot_ends_at?: string | null
          slot_starts_at?: string | null
          status?: string
          world_slug: string
        }
        Update: {
          cancel_reason?: string | null
          cancelled_at?: string | null
          confirm_by?: string | null
          confirmed_at?: string | null
          handed_over_at?: string | null
          handoff_id?: string
          listing_id?: string
          no_show_at?: string | null
          owner_id?: string
          pickup_mode?: string
          pickup_window_end?: string | null
          pickup_window_start?: string | null
          recipient_id?: string
          reserved_at?: string
          seats?: number
          slot_ends_at?: string | null
          slot_starts_at?: string | null
          status?: string
          world_slug?: string
        }
        Relationships: [
          {
            foreignKeyName: "giving_handoffs_listing_id_fkey"
            columns: ["listing_id"]
            isOneToOne: false
            referencedRelation: "listings"
            referencedColumns: ["listing_id"]
          },
          {
            foreignKeyName: "giving_handoffs_listing_id_fkey"
            columns: ["listing_id"]
            isOneToOne: false
            referencedRelation: "marketplace_listing_card"
            referencedColumns: ["listing_id"]
          },
          {
            foreignKeyName: "giving_handoffs_owner_id_fkey"
            columns: ["owner_id"]
            isOneToOne: false
            referencedRelation: "giving_user_trust_score"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "giving_handoffs_owner_id_fkey"
            columns: ["owner_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "giving_handoffs_owner_id_fkey"
            columns: ["owner_id"]
            isOneToOne: false
            referencedRelation: "users_public"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "giving_handoffs_recipient_id_fkey"
            columns: ["recipient_id"]
            isOneToOne: false
            referencedRelation: "giving_user_trust_score"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "giving_handoffs_recipient_id_fkey"
            columns: ["recipient_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "giving_handoffs_recipient_id_fkey"
            columns: ["recipient_id"]
            isOneToOne: false
            referencedRelation: "users_public"
            referencedColumns: ["user_id"]
          },
        ]
      }
      ingestion_runs: {
        Row: {
          finished_at: string | null
          run_id: string
          source_id: string
          started_at: string
          stats: Json
          status: string
        }
        Insert: {
          finished_at?: string | null
          run_id?: string
          source_id: string
          started_at?: string
          stats?: Json
          status?: string
        }
        Update: {
          finished_at?: string | null
          run_id?: string
          source_id?: string
          started_at?: string
          stats?: Json
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "ingestion_runs_source_id_fkey"
            columns: ["source_id"]
            isOneToOne: false
            referencedRelation: "ingestion_sources"
            referencedColumns: ["source_id"]
          },
        ]
      }
      ingestion_sources: {
        Row: {
          consent_ref: string | null
          created_at: string
          is_active: boolean
          label: string
          slug: string
          source_id: string
          source_type: string
        }
        Insert: {
          consent_ref?: string | null
          created_at?: string
          is_active?: boolean
          label: string
          slug: string
          source_id?: string
          source_type: string
        }
        Update: {
          consent_ref?: string | null
          created_at?: string
          is_active?: boolean
          label?: string
          slug?: string
          source_id?: string
          source_type?: string
        }
        Relationships: []
      }
      karma_drift_events: {
        Row: {
          detected_at: string
          drift_id: number
          new_value: number
          old_value: number
          run_id: number
          user_id: string
        }
        Insert: {
          detected_at?: string
          drift_id?: number
          new_value: number
          old_value: number
          run_id: number
          user_id: string
        }
        Update: {
          detected_at?: string
          drift_id?: number
          new_value?: number
          old_value?: number
          run_id?: number
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "karma_drift_events_run_id_fkey"
            columns: ["run_id"]
            isOneToOne: false
            referencedRelation: "karma_recompute_runs"
            referencedColumns: ["run_id"]
          },
          {
            foreignKeyName: "karma_drift_events_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "giving_user_trust_score"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "karma_drift_events_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "karma_drift_events_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users_public"
            referencedColumns: ["user_id"]
          },
        ]
      }
      karma_ledger: {
        Row: {
          created_at: string
          event_type: string
          ledger_id: number
          points_delta: number
          ref_id: string
          ref_type: string
          user_id: string
        }
        Insert: {
          created_at?: string
          event_type: string
          ledger_id?: number
          points_delta: number
          ref_id: string
          ref_type: string
          user_id: string
        }
        Update: {
          created_at?: string
          event_type?: string
          ledger_id?: number
          points_delta?: number
          ref_id?: string
          ref_type?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "karma_ledger_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "giving_user_trust_score"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "karma_ledger_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "karma_ledger_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users_public"
            referencedColumns: ["user_id"]
          },
        ]
      }
      karma_recompute_runs: {
        Row: {
          drift_events: number
          run_at: string
          run_id: number
          users_processed: number
        }
        Insert: {
          drift_events: number
          run_at?: string
          run_id?: number
          users_processed: number
        }
        Update: {
          drift_events?: number
          run_at?: string
          run_id?: number
          users_processed?: number
        }
        Relationships: []
      }
      kc_support_channels: {
        Row: {
          channel: string
          is_active: boolean
          provider_label: string
          updated_at: string
          url: string
        }
        Insert: {
          channel: string
          is_active?: boolean
          provider_label: string
          updated_at?: string
          url: string
        }
        Update: {
          channel?: string
          is_active?: boolean
          provider_label?: string
          updated_at?: string
          url?: string
        }
        Relationships: []
      }
      legal_document_versions: {
        Row: {
          body_md: string
          change_summary: string | null
          content_hash: string
          created_at: string
          doc_type: Database["public"]["Enums"]["legal_doc_type"]
          effective_date: string
          id: string
          language: string
          published_at: string
          published_by: string
          severity: string
          version: number
        }
        Insert: {
          body_md: string
          change_summary?: string | null
          content_hash?: string
          created_at?: string
          doc_type: Database["public"]["Enums"]["legal_doc_type"]
          effective_date: string
          id?: string
          language?: string
          published_at?: string
          published_by: string
          severity: string
          version: number
        }
        Update: {
          body_md?: string
          change_summary?: string | null
          content_hash?: string
          created_at?: string
          doc_type?: Database["public"]["Enums"]["legal_doc_type"]
          effective_date?: string
          id?: string
          language?: string
          published_at?: string
          published_by?: string
          severity?: string
          version?: number
        }
        Relationships: []
      }
      legal_documents: {
        Row: {
          current_effective_date: string
          current_version: number
          doc_type: Database["public"]["Enums"]["legal_doc_type"]
          id: string
          last_material_severity: string | null
          last_material_version: number
          updated_at: string
        }
        Insert: {
          current_effective_date: string
          current_version?: number
          doc_type: Database["public"]["Enums"]["legal_doc_type"]
          id?: string
          last_material_severity?: string | null
          last_material_version?: number
          updated_at?: string
        }
        Update: {
          current_effective_date?: string
          current_version?: number
          doc_type?: Database["public"]["Enums"]["legal_doc_type"]
          id?: string
          last_material_severity?: string | null
          last_material_version?: number
          updated_at?: string
        }
        Relationships: []
      }
      listing_feed_posts: {
        Row: {
          created_at: string
          listing_id: string
          post_id: string
        }
        Insert: {
          created_at?: string
          listing_id: string
          post_id: string
        }
        Update: {
          created_at?: string
          listing_id?: string
          post_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "listing_feed_posts_listing_id_fkey"
            columns: ["listing_id"]
            isOneToOne: true
            referencedRelation: "listings"
            referencedColumns: ["listing_id"]
          },
          {
            foreignKeyName: "listing_feed_posts_listing_id_fkey"
            columns: ["listing_id"]
            isOneToOne: true
            referencedRelation: "marketplace_listing_card"
            referencedColumns: ["listing_id"]
          },
          {
            foreignKeyName: "listing_feed_posts_post_id_fkey"
            columns: ["post_id"]
            isOneToOne: true
            referencedRelation: "feed_visible_posts"
            referencedColumns: ["post_id"]
          },
          {
            foreignKeyName: "listing_feed_posts_post_id_fkey"
            columns: ["post_id"]
            isOneToOne: true
            referencedRelation: "posts"
            referencedColumns: ["post_id"]
          },
        ]
      }
      listing_kinds: {
        Row: {
          created_at: string
          default_ttl_hours: number | null
          detail_schema: Json
          direction: string
          is_active: boolean
          kind_id: string
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
          is_active?: boolean
          kind_id?: string
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
          is_active?: boolean
          kind_id?: string
          label_en?: string
          label_he?: string
          slug?: string
          sort_order?: number
          world_slug?: string
        }
        Relationships: [
          {
            foreignKeyName: "listing_kinds_world_slug_fkey"
            columns: ["world_slug"]
            isOneToOne: false
            referencedRelation: "worlds"
            referencedColumns: ["slug"]
          },
        ]
      }
      listing_matches: {
        Row: {
          candidate_listing_id: string
          created_at: string
          listing_id: string
          match_id: string
          run_id: string | null
          score: number
          status: string
        }
        Insert: {
          candidate_listing_id: string
          created_at?: string
          listing_id: string
          match_id?: string
          run_id?: string | null
          score: number
          status?: string
        }
        Update: {
          candidate_listing_id?: string
          created_at?: string
          listing_id?: string
          match_id?: string
          run_id?: string | null
          score?: number
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "listing_matches_candidate_listing_id_fkey"
            columns: ["candidate_listing_id"]
            isOneToOne: false
            referencedRelation: "listings"
            referencedColumns: ["listing_id"]
          },
          {
            foreignKeyName: "listing_matches_candidate_listing_id_fkey"
            columns: ["candidate_listing_id"]
            isOneToOne: false
            referencedRelation: "marketplace_listing_card"
            referencedColumns: ["listing_id"]
          },
          {
            foreignKeyName: "listing_matches_listing_id_fkey"
            columns: ["listing_id"]
            isOneToOne: false
            referencedRelation: "listings"
            referencedColumns: ["listing_id"]
          },
          {
            foreignKeyName: "listing_matches_listing_id_fkey"
            columns: ["listing_id"]
            isOneToOne: false
            referencedRelation: "marketplace_listing_card"
            referencedColumns: ["listing_id"]
          },
          {
            foreignKeyName: "listing_matches_run_id_fkey"
            columns: ["run_id"]
            isOneToOne: false
            referencedRelation: "match_runs"
            referencedColumns: ["run_id"]
          },
        ]
      }
      listing_media: {
        Row: {
          created_at: string
          listing_id: string
          media_id: string
          sort_order: number
          storage_path: string
        }
        Insert: {
          created_at?: string
          listing_id: string
          media_id?: string
          sort_order?: number
          storage_path: string
        }
        Update: {
          created_at?: string
          listing_id?: string
          media_id?: string
          sort_order?: number
          storage_path?: string
        }
        Relationships: [
          {
            foreignKeyName: "listing_media_listing_id_fkey"
            columns: ["listing_id"]
            isOneToOne: false
            referencedRelation: "listings"
            referencedColumns: ["listing_id"]
          },
          {
            foreignKeyName: "listing_media_listing_id_fkey"
            columns: ["listing_id"]
            isOneToOne: false
            referencedRelation: "marketplace_listing_card"
            referencedColumns: ["listing_id"]
          },
        ]
      }
      listing_user_signals: {
        Row: {
          created_at: string
          listing_id: string
          signal_id: string
          signal_type: string
          user_id: string
          weight: number
        }
        Insert: {
          created_at?: string
          listing_id: string
          signal_id?: string
          signal_type: string
          user_id: string
          weight?: number
        }
        Update: {
          created_at?: string
          listing_id?: string
          signal_id?: string
          signal_type?: string
          user_id?: string
          weight?: number
        }
        Relationships: [
          {
            foreignKeyName: "listing_user_signals_listing_id_fkey"
            columns: ["listing_id"]
            isOneToOne: false
            referencedRelation: "listings"
            referencedColumns: ["listing_id"]
          },
          {
            foreignKeyName: "listing_user_signals_listing_id_fkey"
            columns: ["listing_id"]
            isOneToOne: false
            referencedRelation: "marketplace_listing_card"
            referencedColumns: ["listing_id"]
          },
          {
            foreignKeyName: "listing_user_signals_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "giving_user_trust_score"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "listing_user_signals_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "listing_user_signals_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users_public"
            referencedColumns: ["user_id"]
          },
        ]
      }
      listings: {
        Row: {
          anonymity_level: number
          availability_status: string
          beneficiary_org_id: string | null
          canonical_id: string | null
          category_id: string | null
          city_id: string | null
          created_at: string
          details: Json
          direction: string
          embedding: string | null
          embedding_model: string | null
          expires_at: string | null
          external_body_id: string | null
          geo: unknown
          geo_mode_override: string | null
          geo_weight_override: number | null
          kind_id: string
          legacy_post_id: string | null
          legacy_ride_id: string | null
          listing_id: string
          max_radius_km_override: number | null
          moderation_status: string
          origin: string
          owner_id: string
          published_at: string | null
          search_vector: unknown
          status: string
          summary: string | null
          time_window: unknown
          title: string
          updated_at: string
          urgency_level: number
          visibility: string
          world_slug: string
        }
        Insert: {
          anonymity_level?: number
          availability_status?: string
          beneficiary_org_id?: string | null
          canonical_id?: string | null
          category_id?: string | null
          city_id?: string | null
          created_at?: string
          details?: Json
          direction: string
          embedding?: string | null
          embedding_model?: string | null
          expires_at?: string | null
          external_body_id?: string | null
          geo?: unknown
          geo_mode_override?: string | null
          geo_weight_override?: number | null
          kind_id: string
          legacy_post_id?: string | null
          legacy_ride_id?: string | null
          listing_id?: string
          max_radius_km_override?: number | null
          moderation_status?: string
          origin?: string
          owner_id: string
          published_at?: string | null
          search_vector?: unknown
          status?: string
          summary?: string | null
          time_window?: unknown
          title: string
          updated_at?: string
          urgency_level?: number
          visibility?: string
          world_slug: string
        }
        Update: {
          anonymity_level?: number
          availability_status?: string
          beneficiary_org_id?: string | null
          canonical_id?: string | null
          category_id?: string | null
          city_id?: string | null
          created_at?: string
          details?: Json
          direction?: string
          embedding?: string | null
          embedding_model?: string | null
          expires_at?: string | null
          external_body_id?: string | null
          geo?: unknown
          geo_mode_override?: string | null
          geo_weight_override?: number | null
          kind_id?: string
          legacy_post_id?: string | null
          legacy_ride_id?: string | null
          listing_id?: string
          max_radius_km_override?: number | null
          moderation_status?: string
          origin?: string
          owner_id?: string
          published_at?: string | null
          search_vector?: unknown
          status?: string
          summary?: string | null
          time_window?: unknown
          title?: string
          updated_at?: string
          urgency_level?: number
          visibility?: string
          world_slug?: string
        }
        Relationships: [
          {
            foreignKeyName: "listings_beneficiary_org_id_fkey"
            columns: ["beneficiary_org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["org_id"]
          },
          {
            foreignKeyName: "listings_canonical_id_fkey"
            columns: ["canonical_id"]
            isOneToOne: false
            referencedRelation: "listings"
            referencedColumns: ["listing_id"]
          },
          {
            foreignKeyName: "listings_canonical_id_fkey"
            columns: ["canonical_id"]
            isOneToOne: false
            referencedRelation: "marketplace_listing_card"
            referencedColumns: ["listing_id"]
          },
          {
            foreignKeyName: "listings_category_id_fkey"
            columns: ["category_id"]
            isOneToOne: false
            referencedRelation: "categories"
            referencedColumns: ["category_id"]
          },
          {
            foreignKeyName: "listings_city_id_fkey"
            columns: ["city_id"]
            isOneToOne: false
            referencedRelation: "cities"
            referencedColumns: ["city_id"]
          },
          {
            foreignKeyName: "listings_external_body_id_fkey"
            columns: ["external_body_id"]
            isOneToOne: false
            referencedRelation: "external_bodies"
            referencedColumns: ["body_id"]
          },
          {
            foreignKeyName: "listings_kind_id_fkey"
            columns: ["kind_id"]
            isOneToOne: false
            referencedRelation: "listing_kinds"
            referencedColumns: ["kind_id"]
          },
          {
            foreignKeyName: "listings_legacy_post_id_fkey"
            columns: ["legacy_post_id"]
            isOneToOne: false
            referencedRelation: "feed_visible_posts"
            referencedColumns: ["post_id"]
          },
          {
            foreignKeyName: "listings_legacy_post_id_fkey"
            columns: ["legacy_post_id"]
            isOneToOne: false
            referencedRelation: "posts"
            referencedColumns: ["post_id"]
          },
          {
            foreignKeyName: "listings_legacy_ride_id_fkey"
            columns: ["legacy_ride_id"]
            isOneToOne: false
            referencedRelation: "ride_listings"
            referencedColumns: ["ride_id"]
          },
          {
            foreignKeyName: "listings_owner_id_fkey"
            columns: ["owner_id"]
            isOneToOne: false
            referencedRelation: "giving_user_trust_score"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "listings_owner_id_fkey"
            columns: ["owner_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "listings_owner_id_fkey"
            columns: ["owner_id"]
            isOneToOne: false
            referencedRelation: "users_public"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "listings_world_slug_fkey"
            columns: ["world_slug"]
            isOneToOne: false
            referencedRelation: "worlds"
            referencedColumns: ["slug"]
          },
        ]
      }
      marketplace_actors: {
        Row: {
          actor_id: string
          actor_type: string
          created_at: string
          display_name: string
          listing_id: string | null
          user_id: string | null
        }
        Insert: {
          actor_id?: string
          actor_type: string
          created_at?: string
          display_name: string
          listing_id?: string | null
          user_id?: string | null
        }
        Update: {
          actor_id?: string
          actor_type?: string
          created_at?: string
          display_name?: string
          listing_id?: string | null
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "marketplace_actors_listing_id_fkey"
            columns: ["listing_id"]
            isOneToOne: false
            referencedRelation: "listings"
            referencedColumns: ["listing_id"]
          },
          {
            foreignKeyName: "marketplace_actors_listing_id_fkey"
            columns: ["listing_id"]
            isOneToOne: false
            referencedRelation: "marketplace_listing_card"
            referencedColumns: ["listing_id"]
          },
          {
            foreignKeyName: "marketplace_actors_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "giving_user_trust_score"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "marketplace_actors_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "marketplace_actors_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users_public"
            referencedColumns: ["user_id"]
          },
        ]
      }
      marketplace_rule_params: {
        Row: {
          param_key: string
          param_value: Json
          rule_code: string
        }
        Insert: {
          param_key: string
          param_value: Json
          rule_code: string
        }
        Update: {
          param_key?: string
          param_value?: Json
          rule_code?: string
        }
        Relationships: [
          {
            foreignKeyName: "marketplace_rule_params_rule_code_fkey"
            columns: ["rule_code"]
            isOneToOne: false
            referencedRelation: "marketplace_rules"
            referencedColumns: ["rule_code"]
          },
        ]
      }
      marketplace_rules: {
        Row: {
          is_active: boolean
          label_en: string
          rule_code: string
          world_slug: string | null
        }
        Insert: {
          is_active?: boolean
          label_en: string
          rule_code: string
          world_slug?: string | null
        }
        Update: {
          is_active?: boolean
          label_en?: string
          rule_code?: string
          world_slug?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "marketplace_rules_world_slug_fkey"
            columns: ["world_slug"]
            isOneToOne: false
            referencedRelation: "worlds"
            referencedColumns: ["slug"]
          },
        ]
      }
      match_alert_subscriptions: {
        Row: {
          city_id: string | null
          created_at: string
          direction: string | null
          is_active: boolean
          saved_query: string | null
          subscription_id: string
          updated_at: string
          user_id: string
          world_slug: string | null
        }
        Insert: {
          city_id?: string | null
          created_at?: string
          direction?: string | null
          is_active?: boolean
          saved_query?: string | null
          subscription_id?: string
          updated_at?: string
          user_id: string
          world_slug?: string | null
        }
        Update: {
          city_id?: string | null
          created_at?: string
          direction?: string | null
          is_active?: boolean
          saved_query?: string | null
          subscription_id?: string
          updated_at?: string
          user_id?: string
          world_slug?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "match_alert_subscriptions_city_id_fkey"
            columns: ["city_id"]
            isOneToOne: false
            referencedRelation: "cities"
            referencedColumns: ["city_id"]
          },
          {
            foreignKeyName: "match_alert_subscriptions_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "giving_user_trust_score"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "match_alert_subscriptions_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "match_alert_subscriptions_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users_public"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "match_alert_subscriptions_world_slug_fkey"
            columns: ["world_slug"]
            isOneToOne: false
            referencedRelation: "worlds"
            referencedColumns: ["slug"]
          },
        ]
      }
      match_candidates: {
        Row: {
          candidate_id: string
          components: Json
          computed_at: string
          created_at: string
          delivery: Json
          distance_km: number | null
          llm_reason: string | null
          llm_score: number | null
          llm_scored_at: string | null
          notified_offer_at: string | null
          notified_request_at: string | null
          offer_listing_id: string
          offer_owner_id: string
          offer_responded_at: string | null
          offer_response: string | null
          request_listing_id: string
          request_owner_id: string
          request_responded_at: string | null
          request_response: string | null
          score: number
          status: string
          updated_at: string
          world_slug: string
        }
        Insert: {
          candidate_id?: string
          components?: Json
          computed_at?: string
          created_at?: string
          delivery?: Json
          distance_km?: number | null
          llm_reason?: string | null
          llm_score?: number | null
          llm_scored_at?: string | null
          notified_offer_at?: string | null
          notified_request_at?: string | null
          offer_listing_id: string
          offer_owner_id: string
          offer_responded_at?: string | null
          offer_response?: string | null
          request_listing_id: string
          request_owner_id: string
          request_responded_at?: string | null
          request_response?: string | null
          score: number
          status?: string
          updated_at?: string
          world_slug: string
        }
        Update: {
          candidate_id?: string
          components?: Json
          computed_at?: string
          created_at?: string
          delivery?: Json
          distance_km?: number | null
          llm_reason?: string | null
          llm_score?: number | null
          llm_scored_at?: string | null
          notified_offer_at?: string | null
          notified_request_at?: string | null
          offer_listing_id?: string
          offer_owner_id?: string
          offer_responded_at?: string | null
          offer_response?: string | null
          request_listing_id?: string
          request_owner_id?: string
          request_responded_at?: string | null
          request_response?: string | null
          score?: number
          status?: string
          updated_at?: string
          world_slug?: string
        }
        Relationships: [
          {
            foreignKeyName: "match_candidates_offer_listing_id_fkey"
            columns: ["offer_listing_id"]
            isOneToOne: false
            referencedRelation: "listings"
            referencedColumns: ["listing_id"]
          },
          {
            foreignKeyName: "match_candidates_offer_listing_id_fkey"
            columns: ["offer_listing_id"]
            isOneToOne: false
            referencedRelation: "marketplace_listing_card"
            referencedColumns: ["listing_id"]
          },
          {
            foreignKeyName: "match_candidates_offer_owner_id_fkey"
            columns: ["offer_owner_id"]
            isOneToOne: false
            referencedRelation: "giving_user_trust_score"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "match_candidates_offer_owner_id_fkey"
            columns: ["offer_owner_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "match_candidates_offer_owner_id_fkey"
            columns: ["offer_owner_id"]
            isOneToOne: false
            referencedRelation: "users_public"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "match_candidates_request_listing_id_fkey"
            columns: ["request_listing_id"]
            isOneToOne: false
            referencedRelation: "listings"
            referencedColumns: ["listing_id"]
          },
          {
            foreignKeyName: "match_candidates_request_listing_id_fkey"
            columns: ["request_listing_id"]
            isOneToOne: false
            referencedRelation: "marketplace_listing_card"
            referencedColumns: ["listing_id"]
          },
          {
            foreignKeyName: "match_candidates_request_owner_id_fkey"
            columns: ["request_owner_id"]
            isOneToOne: false
            referencedRelation: "giving_user_trust_score"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "match_candidates_request_owner_id_fkey"
            columns: ["request_owner_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "match_candidates_request_owner_id_fkey"
            columns: ["request_owner_id"]
            isOneToOne: false
            referencedRelation: "users_public"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "match_candidates_world_slug_fkey"
            columns: ["world_slug"]
            isOneToOne: false
            referencedRelation: "worlds"
            referencedColumns: ["slug"]
          },
        ]
      }
      match_feedback: {
        Row: {
          comment: string | null
          created_at: string
          feedback_id: string
          match_id: string
          rating: number
          user_id: string
        }
        Insert: {
          comment?: string | null
          created_at?: string
          feedback_id?: string
          match_id: string
          rating: number
          user_id: string
        }
        Update: {
          comment?: string | null
          created_at?: string
          feedback_id?: string
          match_id?: string
          rating?: number
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "match_feedback_match_id_fkey"
            columns: ["match_id"]
            isOneToOne: false
            referencedRelation: "listing_matches"
            referencedColumns: ["match_id"]
          },
          {
            foreignKeyName: "match_feedback_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "giving_user_trust_score"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "match_feedback_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "match_feedback_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users_public"
            referencedColumns: ["user_id"]
          },
        ]
      }
      match_listing_state: {
        Row: {
          candidates: number
          computed_at: string
          last_error: string | null
          listing_id: string
        }
        Insert: {
          candidates?: number
          computed_at?: string
          last_error?: string | null
          listing_id: string
        }
        Update: {
          candidates?: number
          computed_at?: string
          last_error?: string | null
          listing_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "match_listing_state_listing_id_fkey"
            columns: ["listing_id"]
            isOneToOne: true
            referencedRelation: "listings"
            referencedColumns: ["listing_id"]
          },
          {
            foreignKeyName: "match_listing_state_listing_id_fkey"
            columns: ["listing_id"]
            isOneToOne: true
            referencedRelation: "marketplace_listing_card"
            referencedColumns: ["listing_id"]
          },
        ]
      }
      match_runs: {
        Row: {
          finished_at: string | null
          run_id: string
          source_listing_id: string
          started_at: string
          stats: Json
          triggered_by: string | null
        }
        Insert: {
          finished_at?: string | null
          run_id?: string
          source_listing_id: string
          started_at?: string
          stats?: Json
          triggered_by?: string | null
        }
        Update: {
          finished_at?: string | null
          run_id?: string
          source_listing_id?: string
          started_at?: string
          stats?: Json
          triggered_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "match_runs_source_listing_id_fkey"
            columns: ["source_listing_id"]
            isOneToOne: false
            referencedRelation: "listings"
            referencedColumns: ["listing_id"]
          },
          {
            foreignKeyName: "match_runs_source_listing_id_fkey"
            columns: ["source_listing_id"]
            isOneToOne: false
            referencedRelation: "marketplace_listing_card"
            referencedColumns: ["listing_id"]
          },
          {
            foreignKeyName: "match_runs_triggered_by_fkey"
            columns: ["triggered_by"]
            isOneToOne: false
            referencedRelation: "giving_user_trust_score"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "match_runs_triggered_by_fkey"
            columns: ["triggered_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "match_runs_triggered_by_fkey"
            columns: ["triggered_by"]
            isOneToOne: false
            referencedRelation: "users_public"
            referencedColumns: ["user_id"]
          },
        ]
      }
      match_weights: {
        Row: {
          created_at: string
          user_id: string | null
          w_fts: number
          w_geo: number
          w_trust: number
          w_vector: number
          weight_id: string
          world_slug: string | null
        }
        Insert: {
          created_at?: string
          user_id?: string | null
          w_fts?: number
          w_geo?: number
          w_trust?: number
          w_vector?: number
          weight_id?: string
          world_slug?: string | null
        }
        Update: {
          created_at?: string
          user_id?: string | null
          w_fts?: number
          w_geo?: number
          w_trust?: number
          w_vector?: number
          weight_id?: string
          world_slug?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "match_weights_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "giving_user_trust_score"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "match_weights_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "match_weights_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users_public"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "match_weights_world_slug_fkey"
            columns: ["world_slug"]
            isOneToOne: false
            referencedRelation: "worlds"
            referencedColumns: ["slug"]
          },
        ]
      }
      matching_settings: {
        Row: {
          enabled: boolean
          id: boolean
          inline_on_write: boolean
          llm_rerank_enabled: boolean
          llm_weight: number
          max_candidates_per_listing: number
          max_notify_per_user_day: number
          min_score: number
          notify_max_age_hours: number
          notify_min_score: number
          notify_min_text: number
          quiet_end: string
          quiet_start: string
          quiet_tz: string
          recompute_after_hours: number
          scan_limit: number
          sweep_batch: number
          updated_at: string
          weights: Json
          worlds: string[]
        }
        Insert: {
          enabled?: boolean
          id?: boolean
          inline_on_write?: boolean
          llm_rerank_enabled?: boolean
          llm_weight?: number
          max_candidates_per_listing?: number
          max_notify_per_user_day?: number
          min_score?: number
          notify_max_age_hours?: number
          notify_min_score?: number
          notify_min_text?: number
          quiet_end?: string
          quiet_start?: string
          quiet_tz?: string
          recompute_after_hours?: number
          scan_limit?: number
          sweep_batch?: number
          updated_at?: string
          weights?: Json
          worlds?: string[]
        }
        Update: {
          enabled?: boolean
          id?: boolean
          inline_on_write?: boolean
          llm_rerank_enabled?: boolean
          llm_weight?: number
          max_candidates_per_listing?: number
          max_notify_per_user_day?: number
          min_score?: number
          notify_max_age_hours?: number
          notify_min_score?: number
          notify_min_text?: number
          quiet_end?: string
          quiet_start?: string
          quiet_tz?: string
          recompute_after_hours?: number
          scan_limit?: number
          sweep_batch?: number
          updated_at?: string
          weights?: Json
          worlds?: string[]
        }
        Relationships: []
      }
      media_assets: {
        Row: {
          bucket: string
          created_at: string
          media_asset_id: string
          mime_type: string
          ordinal: number
          path: string
          post_id: string
          size_bytes: number
        }
        Insert: {
          bucket?: string
          created_at?: string
          media_asset_id?: string
          mime_type: string
          ordinal: number
          path: string
          post_id: string
          size_bytes: number
        }
        Update: {
          bucket?: string
          created_at?: string
          media_asset_id?: string
          mime_type?: string
          ordinal?: number
          path?: string
          post_id?: string
          size_bytes?: number
        }
        Relationships: [
          {
            foreignKeyName: "media_assets_post_id_fkey"
            columns: ["post_id"]
            isOneToOne: false
            referencedRelation: "feed_visible_posts"
            referencedColumns: ["post_id"]
          },
          {
            foreignKeyName: "media_assets_post_id_fkey"
            columns: ["post_id"]
            isOneToOne: false
            referencedRelation: "posts"
            referencedColumns: ["post_id"]
          },
        ]
      }
      message_reactions: {
        Row: {
          created_at: string
          message_id: string
          reaction_id: string
          reaction_type: string
          user_id: string
        }
        Insert: {
          created_at?: string
          message_id: string
          reaction_id?: string
          reaction_type: string
          user_id: string
        }
        Update: {
          created_at?: string
          message_id?: string
          reaction_id?: string
          reaction_type?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "message_reactions_message_id_fkey"
            columns: ["message_id"]
            isOneToOne: false
            referencedRelation: "messages"
            referencedColumns: ["message_id"]
          },
          {
            foreignKeyName: "message_reactions_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "giving_user_trust_score"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "message_reactions_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "message_reactions_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users_public"
            referencedColumns: ["user_id"]
          },
        ]
      }
      messages: {
        Row: {
          body: string | null
          chat_id: string
          created_at: string
          delivered_at: string | null
          kind: string
          media_payload: Json | null
          message_id: string
          read_at: string | null
          sender_id: string | null
          source_language: string | null
          source_language_confidence: number | null
          status: string
          system_payload: Json | null
        }
        Insert: {
          body?: string | null
          chat_id: string
          created_at?: string
          delivered_at?: string | null
          kind?: string
          media_payload?: Json | null
          message_id?: string
          read_at?: string | null
          sender_id?: string | null
          source_language?: string | null
          source_language_confidence?: number | null
          status?: string
          system_payload?: Json | null
        }
        Update: {
          body?: string | null
          chat_id?: string
          created_at?: string
          delivered_at?: string | null
          kind?: string
          media_payload?: Json | null
          message_id?: string
          read_at?: string | null
          sender_id?: string | null
          source_language?: string | null
          source_language_confidence?: number | null
          status?: string
          system_payload?: Json | null
        }
        Relationships: [
          {
            foreignKeyName: "messages_chat_id_fkey"
            columns: ["chat_id"]
            isOneToOne: false
            referencedRelation: "chats"
            referencedColumns: ["chat_id"]
          },
          {
            foreignKeyName: "messages_sender_id_fkey"
            columns: ["sender_id"]
            isOneToOne: false
            referencedRelation: "giving_user_trust_score"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "messages_sender_id_fkey"
            columns: ["sender_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "messages_sender_id_fkey"
            columns: ["sender_id"]
            isOneToOne: false
            referencedRelation: "users_public"
            referencedColumns: ["user_id"]
          },
        ]
      }
      moderation_queue_entries: {
        Row: {
          created_at: string
          entry_id: string
          metadata: Json | null
          reason: string
          resolved_at: string | null
          resolved_by: string | null
          target_id: string
          target_type: string
        }
        Insert: {
          created_at?: string
          entry_id?: string
          metadata?: Json | null
          reason: string
          resolved_at?: string | null
          resolved_by?: string | null
          target_id: string
          target_type: string
        }
        Update: {
          created_at?: string
          entry_id?: string
          metadata?: Json | null
          reason?: string
          resolved_at?: string | null
          resolved_by?: string | null
          target_id?: string
          target_type?: string
        }
        Relationships: [
          {
            foreignKeyName: "moderation_queue_entries_resolved_by_fkey"
            columns: ["resolved_by"]
            isOneToOne: false
            referencedRelation: "giving_user_trust_score"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "moderation_queue_entries_resolved_by_fkey"
            columns: ["resolved_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "moderation_queue_entries_resolved_by_fkey"
            columns: ["resolved_by"]
            isOneToOne: false
            referencedRelation: "users_public"
            referencedColumns: ["user_id"]
          },
        ]
      }
      notification_inbox: {
        Row: {
          body_args: Json
          body_key: string
          category: string
          created_at: string
          data: Json
          group_actor_ids: string[]
          group_count: number
          group_key: string | null
          inbox_id: string
          kind: string
          outbox_id: string | null
          read_at: string | null
          title_key: string
          updated_at: string
          user_id: string
          world: string
        }
        Insert: {
          body_args?: Json
          body_key: string
          category: string
          created_at?: string
          data?: Json
          group_actor_ids?: string[]
          group_count?: number
          group_key?: string | null
          inbox_id?: string
          kind: string
          outbox_id?: string | null
          read_at?: string | null
          title_key: string
          updated_at?: string
          user_id: string
          world?: string
        }
        Update: {
          body_args?: Json
          body_key?: string
          category?: string
          created_at?: string
          data?: Json
          group_actor_ids?: string[]
          group_count?: number
          group_key?: string | null
          inbox_id?: string
          kind?: string
          outbox_id?: string | null
          read_at?: string | null
          title_key?: string
          updated_at?: string
          user_id?: string
          world?: string
        }
        Relationships: [
          {
            foreignKeyName: "notification_inbox_outbox_id_fkey"
            columns: ["outbox_id"]
            isOneToOne: false
            referencedRelation: "notifications_outbox"
            referencedColumns: ["notification_id"]
          },
          {
            foreignKeyName: "notification_inbox_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "giving_user_trust_score"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "notification_inbox_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "notification_inbox_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users_public"
            referencedColumns: ["user_id"]
          },
        ]
      }
      notifications_outbox: {
        Row: {
          attempts: number
          body_args: Json
          body_key: string
          bypass_preferences: boolean
          category: string
          created_at: string
          data: Json
          dedupe_key: string | null
          dispatched_at: string | null
          expires_at: string
          kind: string
          last_error: string | null
          notification_id: string
          title_key: string
          user_id: string
        }
        Insert: {
          attempts?: number
          body_args?: Json
          body_key: string
          bypass_preferences?: boolean
          category: string
          created_at?: string
          data?: Json
          dedupe_key?: string | null
          dispatched_at?: string | null
          expires_at?: string
          kind: string
          last_error?: string | null
          notification_id?: string
          title_key: string
          user_id: string
        }
        Update: {
          attempts?: number
          body_args?: Json
          body_key?: string
          bypass_preferences?: boolean
          category?: string
          created_at?: string
          data?: Json
          dedupe_key?: string | null
          dispatched_at?: string | null
          expires_at?: string
          kind?: string
          last_error?: string | null
          notification_id?: string
          title_key?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "notifications_outbox_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "giving_user_trust_score"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "notifications_outbox_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "notifications_outbox_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users_public"
            referencedColumns: ["user_id"]
          },
        ]
      }
      operator_case_events: {
        Row: {
          actor_id: string | null
          case_id: string
          created_at: string
          event_id: string
          event_type: string
          payload: Json
        }
        Insert: {
          actor_id?: string | null
          case_id: string
          created_at?: string
          event_id?: string
          event_type: string
          payload?: Json
        }
        Update: {
          actor_id?: string | null
          case_id?: string
          created_at?: string
          event_id?: string
          event_type?: string
          payload?: Json
        }
        Relationships: [
          {
            foreignKeyName: "operator_case_events_actor_id_fkey"
            columns: ["actor_id"]
            isOneToOne: false
            referencedRelation: "giving_user_trust_score"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "operator_case_events_actor_id_fkey"
            columns: ["actor_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "operator_case_events_actor_id_fkey"
            columns: ["actor_id"]
            isOneToOne: false
            referencedRelation: "users_public"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "operator_case_events_case_id_fkey"
            columns: ["case_id"]
            isOneToOne: false
            referencedRelation: "operator_cases"
            referencedColumns: ["case_id"]
          },
        ]
      }
      operator_cases: {
        Row: {
          assigned_operator_id: string | null
          case_id: string
          created_at: string
          listing_id: string
          priority: number
          status: string
          updated_at: string
        }
        Insert: {
          assigned_operator_id?: string | null
          case_id?: string
          created_at?: string
          listing_id: string
          priority?: number
          status?: string
          updated_at?: string
        }
        Update: {
          assigned_operator_id?: string | null
          case_id?: string
          created_at?: string
          listing_id?: string
          priority?: number
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "operator_cases_assigned_operator_id_fkey"
            columns: ["assigned_operator_id"]
            isOneToOne: false
            referencedRelation: "giving_user_trust_score"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "operator_cases_assigned_operator_id_fkey"
            columns: ["assigned_operator_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "operator_cases_assigned_operator_id_fkey"
            columns: ["assigned_operator_id"]
            isOneToOne: false
            referencedRelation: "users_public"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "operator_cases_listing_id_fkey"
            columns: ["listing_id"]
            isOneToOne: true
            referencedRelation: "listings"
            referencedColumns: ["listing_id"]
          },
          {
            foreignKeyName: "operator_cases_listing_id_fkey"
            columns: ["listing_id"]
            isOneToOne: true
            referencedRelation: "marketplace_listing_card"
            referencedColumns: ["listing_id"]
          },
        ]
      }
      org_applications: {
        Row: {
          applicant_user_id: string
          application_id: string
          contact_email: string | null
          contact_phone: string | null
          created_at: string
          org_description: string | null
          org_name: string
          review_note: string | null
          reviewed_at: string | null
          reviewed_by: string | null
          status: string
          website_url: string | null
        }
        Insert: {
          applicant_user_id: string
          application_id?: string
          contact_email?: string | null
          contact_phone?: string | null
          created_at?: string
          org_description?: string | null
          org_name: string
          review_note?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          status?: string
          website_url?: string | null
        }
        Update: {
          applicant_user_id?: string
          application_id?: string
          contact_email?: string | null
          contact_phone?: string | null
          created_at?: string
          org_description?: string | null
          org_name?: string
          review_note?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          status?: string
          website_url?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "org_applications_applicant_user_id_fkey"
            columns: ["applicant_user_id"]
            isOneToOne: false
            referencedRelation: "giving_user_trust_score"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "org_applications_applicant_user_id_fkey"
            columns: ["applicant_user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "org_applications_applicant_user_id_fkey"
            columns: ["applicant_user_id"]
            isOneToOne: false
            referencedRelation: "users_public"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "org_applications_reviewed_by_fkey"
            columns: ["reviewed_by"]
            isOneToOne: false
            referencedRelation: "giving_user_trust_score"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "org_applications_reviewed_by_fkey"
            columns: ["reviewed_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "org_applications_reviewed_by_fkey"
            columns: ["reviewed_by"]
            isOneToOne: false
            referencedRelation: "users_public"
            referencedColumns: ["user_id"]
          },
        ]
      }
      org_memberships: {
        Row: {
          created_at: string
          membership_id: string
          org_id: string
          role: string
          user_id: string
        }
        Insert: {
          created_at?: string
          membership_id?: string
          org_id: string
          role: string
          user_id: string
        }
        Update: {
          created_at?: string
          membership_id?: string
          org_id?: string
          role?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "org_memberships_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["org_id"]
          },
          {
            foreignKeyName: "org_memberships_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "giving_user_trust_score"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "org_memberships_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "org_memberships_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users_public"
            referencedColumns: ["user_id"]
          },
        ]
      }
      organizations: {
        Row: {
          created_at: string
          is_platform: boolean
          is_verified_nonprofit: boolean
          name: string
          org_id: string
          public_about_en: string | null
          public_about_he: string | null
          public_tagline_en: string | null
          public_tagline_he: string | null
          slug: string
          verification_method: string | null
          verified_at: string | null
        }
        Insert: {
          created_at?: string
          is_platform?: boolean
          is_verified_nonprofit?: boolean
          name: string
          org_id?: string
          public_about_en?: string | null
          public_about_he?: string | null
          public_tagline_en?: string | null
          public_tagline_he?: string | null
          slug: string
          verification_method?: string | null
          verified_at?: string | null
        }
        Update: {
          created_at?: string
          is_platform?: boolean
          is_verified_nonprofit?: boolean
          name?: string
          org_id?: string
          public_about_en?: string | null
          public_about_he?: string | null
          public_tagline_en?: string | null
          public_tagline_he?: string | null
          slug?: string
          verification_method?: string | null
          verified_at?: string | null
        }
        Relationships: []
      }
      payer_kyc_profiles: {
        Row: {
          cumulative_donated_ils: number
          kyc_required_threshold_ils: number
          provider_ref: string | null
          status: string
          updated_at: string
          user_id: string
          verified_at: string | null
        }
        Insert: {
          cumulative_donated_ils?: number
          kyc_required_threshold_ils?: number
          provider_ref?: string | null
          status?: string
          updated_at?: string
          user_id: string
          verified_at?: string | null
        }
        Update: {
          cumulative_donated_ils?: number
          kyc_required_threshold_ils?: number
          provider_ref?: string | null
          status?: string
          updated_at?: string
          user_id?: string
          verified_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "payer_kyc_profiles_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: true
            referencedRelation: "giving_user_trust_score"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "payer_kyc_profiles_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: true
            referencedRelation: "users"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "payer_kyc_profiles_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: true
            referencedRelation: "users_public"
            referencedColumns: ["user_id"]
          },
        ]
      }
      payment_ledger_entries: {
        Row: {
          account_code: string
          created_at: string
          credit_ils: number
          currency: string
          debit_ils: number
          entry_id: string
          idempotency_key: string
          ref_id: string | null
          ref_type: string | null
          txn_id: string
        }
        Insert: {
          account_code: string
          created_at?: string
          credit_ils?: number
          currency?: string
          debit_ils?: number
          entry_id?: string
          idempotency_key: string
          ref_id?: string | null
          ref_type?: string | null
          txn_id: string
        }
        Update: {
          account_code?: string
          created_at?: string
          credit_ils?: number
          currency?: string
          debit_ils?: number
          entry_id?: string
          idempotency_key?: string
          ref_id?: string | null
          ref_type?: string | null
          txn_id?: string
        }
        Relationships: []
      }
      payment_methods: {
        Row: {
          brand: string | null
          created_at: string
          exp_month: number | null
          exp_year: number | null
          is_default: boolean
          last4: string | null
          method_id: string
          provider_id: string
          provider_token: string
          user_id: string
        }
        Insert: {
          brand?: string | null
          created_at?: string
          exp_month?: number | null
          exp_year?: number | null
          is_default?: boolean
          last4?: string | null
          method_id?: string
          provider_id: string
          provider_token: string
          user_id: string
        }
        Update: {
          brand?: string | null
          created_at?: string
          exp_month?: number | null
          exp_year?: number | null
          is_default?: boolean
          last4?: string | null
          method_id?: string
          provider_id?: string
          provider_token?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "payment_methods_provider_id_fkey"
            columns: ["provider_id"]
            isOneToOne: false
            referencedRelation: "payment_providers"
            referencedColumns: ["provider_id"]
          },
          {
            foreignKeyName: "payment_methods_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "giving_user_trust_score"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "payment_methods_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "payment_methods_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users_public"
            referencedColumns: ["user_id"]
          },
        ]
      }
      payment_payouts: {
        Row: {
          amount_ils: number
          created_at: string
          idempotency_key: string
          org_id: string
          payout_id: string
          provider_ref: string | null
          status: string
        }
        Insert: {
          amount_ils: number
          created_at?: string
          idempotency_key: string
          org_id: string
          payout_id?: string
          provider_ref?: string | null
          status?: string
        }
        Update: {
          amount_ils?: number
          created_at?: string
          idempotency_key?: string
          org_id?: string
          payout_id?: string
          provider_ref?: string | null
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "payment_payouts_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["org_id"]
          },
        ]
      }
      payment_providers: {
        Row: {
          config_public: Json
          created_at: string
          display_name: string
          is_active: boolean
          provider_id: string
          slug: string
        }
        Insert: {
          config_public?: Json
          created_at?: string
          display_name: string
          is_active?: boolean
          provider_id?: string
          slug: string
        }
        Update: {
          config_public?: Json
          created_at?: string
          display_name?: string
          is_active?: boolean
          provider_id?: string
          slug?: string
        }
        Relationships: []
      }
      payment_recipients_kyc: {
        Row: {
          created_at: string
          org_id: string
          provider_ref: string | null
          recipient_kyc_id: string
          reviewed_at: string | null
          status: string
        }
        Insert: {
          created_at?: string
          org_id: string
          provider_ref?: string | null
          recipient_kyc_id?: string
          reviewed_at?: string | null
          status?: string
        }
        Update: {
          created_at?: string
          org_id?: string
          provider_ref?: string | null
          recipient_kyc_id?: string
          reviewed_at?: string | null
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "payment_recipients_kyc_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: true
            referencedRelation: "organizations"
            referencedColumns: ["org_id"]
          },
        ]
      }
      payment_refunds: {
        Row: {
          amount_ils: number
          created_at: string
          idempotency_key: string
          payment_id: string
          provider_ref: string | null
          reason: string | null
          refund_id: string
          status: string
        }
        Insert: {
          amount_ils: number
          created_at?: string
          idempotency_key: string
          payment_id: string
          provider_ref?: string | null
          reason?: string | null
          refund_id?: string
          status?: string
        }
        Update: {
          amount_ils?: number
          created_at?: string
          idempotency_key?: string
          payment_id?: string
          provider_ref?: string | null
          reason?: string | null
          refund_id?: string
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "payment_refunds_payment_id_fkey"
            columns: ["payment_id"]
            isOneToOne: false
            referencedRelation: "payments"
            referencedColumns: ["payment_id"]
          },
        ]
      }
      payments: {
        Row: {
          amount_ils: number
          created_at: string
          idempotency_key: string
          intent_id: string
          method_id: string | null
          org_id: string
          payment_id: string
          provider_id: string | null
          provider_ref: string | null
          status: string
          user_id: string | null
        }
        Insert: {
          amount_ils: number
          created_at?: string
          idempotency_key: string
          intent_id: string
          method_id?: string | null
          org_id: string
          payment_id?: string
          provider_id?: string | null
          provider_ref?: string | null
          status?: string
          user_id?: string | null
        }
        Update: {
          amount_ils?: number
          created_at?: string
          idempotency_key?: string
          intent_id?: string
          method_id?: string | null
          org_id?: string
          payment_id?: string
          provider_id?: string | null
          provider_ref?: string | null
          status?: string
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "payments_intent_id_fkey"
            columns: ["intent_id"]
            isOneToOne: false
            referencedRelation: "donation_intents"
            referencedColumns: ["intent_id"]
          },
          {
            foreignKeyName: "payments_method_id_fkey"
            columns: ["method_id"]
            isOneToOne: false
            referencedRelation: "payment_methods"
            referencedColumns: ["method_id"]
          },
          {
            foreignKeyName: "payments_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["org_id"]
          },
          {
            foreignKeyName: "payments_provider_id_fkey"
            columns: ["provider_id"]
            isOneToOne: false
            referencedRelation: "payment_providers"
            referencedColumns: ["provider_id"]
          },
          {
            foreignKeyName: "payments_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "giving_user_trust_score"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "payments_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "payments_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users_public"
            referencedColumns: ["user_id"]
          },
        ]
      }
      post_actor_identity: {
        Row: {
          hide_from_counterparty: boolean
          identity_visibility: string
          post_id: string
          surface_visibility: string
          updated_at: string
          user_id: string
        }
        Insert: {
          hide_from_counterparty?: boolean
          identity_visibility: string
          post_id: string
          surface_visibility?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          hide_from_counterparty?: boolean
          identity_visibility?: string
          post_id?: string
          surface_visibility?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "post_actor_identity_post_id_fkey"
            columns: ["post_id"]
            isOneToOne: false
            referencedRelation: "feed_visible_posts"
            referencedColumns: ["post_id"]
          },
          {
            foreignKeyName: "post_actor_identity_post_id_fkey"
            columns: ["post_id"]
            isOneToOne: false
            referencedRelation: "posts"
            referencedColumns: ["post_id"]
          },
          {
            foreignKeyName: "post_actor_identity_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "giving_user_trust_score"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "post_actor_identity_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "post_actor_identity_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users_public"
            referencedColumns: ["user_id"]
          },
        ]
      }
      post_comments: {
        Row: {
          author_id: string
          body: string
          comment_id: string
          created_at: string
          edited_at: string | null
          mention_user_ids: string[]
          parent_comment_id: string | null
          post_id: string
          status: string
          updated_at: string
        }
        Insert: {
          author_id: string
          body: string
          comment_id?: string
          created_at?: string
          edited_at?: string | null
          mention_user_ids?: string[]
          parent_comment_id?: string | null
          post_id: string
          status?: string
          updated_at?: string
        }
        Update: {
          author_id?: string
          body?: string
          comment_id?: string
          created_at?: string
          edited_at?: string | null
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
            isOneToOne: false
            referencedRelation: "giving_user_trust_score"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "post_comments_author_id_fkey"
            columns: ["author_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "post_comments_author_id_fkey"
            columns: ["author_id"]
            isOneToOne: false
            referencedRelation: "users_public"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "post_comments_parent_comment_id_fkey"
            columns: ["parent_comment_id"]
            isOneToOne: false
            referencedRelation: "post_comments"
            referencedColumns: ["comment_id"]
          },
          {
            foreignKeyName: "post_comments_post_id_fkey"
            columns: ["post_id"]
            isOneToOne: false
            referencedRelation: "feed_visible_posts"
            referencedColumns: ["post_id"]
          },
          {
            foreignKeyName: "post_comments_post_id_fkey"
            columns: ["post_id"]
            isOneToOne: false
            referencedRelation: "posts"
            referencedColumns: ["post_id"]
          },
        ]
      }
      post_reactions: {
        Row: {
          created_at: string
          post_id: string
          reaction_id: string
          reaction_type: string
          user_id: string
        }
        Insert: {
          created_at?: string
          post_id: string
          reaction_id?: string
          reaction_type: string
          user_id: string
        }
        Update: {
          created_at?: string
          post_id?: string
          reaction_id?: string
          reaction_type?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "post_reactions_post_id_fkey"
            columns: ["post_id"]
            isOneToOne: false
            referencedRelation: "feed_visible_posts"
            referencedColumns: ["post_id"]
          },
          {
            foreignKeyName: "post_reactions_post_id_fkey"
            columns: ["post_id"]
            isOneToOne: false
            referencedRelation: "posts"
            referencedColumns: ["post_id"]
          },
          {
            foreignKeyName: "post_reactions_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "giving_user_trust_score"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "post_reactions_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "post_reactions_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users_public"
            referencedColumns: ["user_id"]
          },
        ]
      }
      post_shares: {
        Row: {
          created_at: string
          external_channel: string | null
          post_id: string
          repost_post_id: string | null
          share_id: string
          share_kind: string
          user_id: string
        }
        Insert: {
          created_at?: string
          external_channel?: string | null
          post_id: string
          repost_post_id?: string | null
          share_id?: string
          share_kind: string
          user_id: string
        }
        Update: {
          created_at?: string
          external_channel?: string | null
          post_id?: string
          repost_post_id?: string | null
          share_id?: string
          share_kind?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "post_shares_post_id_fkey"
            columns: ["post_id"]
            isOneToOne: false
            referencedRelation: "feed_visible_posts"
            referencedColumns: ["post_id"]
          },
          {
            foreignKeyName: "post_shares_post_id_fkey"
            columns: ["post_id"]
            isOneToOne: false
            referencedRelation: "posts"
            referencedColumns: ["post_id"]
          },
          {
            foreignKeyName: "post_shares_repost_post_id_fkey"
            columns: ["repost_post_id"]
            isOneToOne: false
            referencedRelation: "feed_visible_posts"
            referencedColumns: ["post_id"]
          },
          {
            foreignKeyName: "post_shares_repost_post_id_fkey"
            columns: ["repost_post_id"]
            isOneToOne: false
            referencedRelation: "posts"
            referencedColumns: ["post_id"]
          },
          {
            foreignKeyName: "post_shares_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "giving_user_trust_score"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "post_shares_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "post_shares_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users_public"
            referencedColumns: ["user_id"]
          },
        ]
      }
      post_stats: {
        Row: {
          comment_count: number
          post_id: string
          reaction_count: number
          share_count: number
          updated_at: string
        }
        Insert: {
          comment_count?: number
          post_id: string
          reaction_count?: number
          share_count?: number
          updated_at?: string
        }
        Update: {
          comment_count?: number
          post_id?: string
          reaction_count?: number
          share_count?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "post_stats_post_id_fkey"
            columns: ["post_id"]
            isOneToOne: true
            referencedRelation: "feed_visible_posts"
            referencedColumns: ["post_id"]
          },
          {
            foreignKeyName: "post_stats_post_id_fkey"
            columns: ["post_id"]
            isOneToOne: true
            referencedRelation: "posts"
            referencedColumns: ["post_id"]
          },
        ]
      }
      posts: {
        Row: {
          category: string
          city: string
          created_at: string
          delete_after: string | null
          description: string | null
          estimated_value: number | null
          item_condition: string | null
          listing_id: string | null
          listing_world_slug: string | null
          location_display_level: string
          owner_id: string
          post_id: string
          reopen_count: number
          search_vector: unknown
          source_language: string | null
          source_language_confidence: number | null
          status: string
          status_before_admin_removal: string | null
          street: string
          street_number: string
          title: string
          type: string
          updated_at: string
          urgency: string | null
          visibility: string
        }
        Insert: {
          category?: string
          city: string
          created_at?: string
          delete_after?: string | null
          description?: string | null
          estimated_value?: number | null
          item_condition?: string | null
          listing_id?: string | null
          listing_world_slug?: string | null
          location_display_level?: string
          owner_id: string
          post_id?: string
          reopen_count?: number
          search_vector?: unknown
          source_language?: string | null
          source_language_confidence?: number | null
          status?: string
          status_before_admin_removal?: string | null
          street: string
          street_number: string
          title: string
          type: string
          updated_at?: string
          urgency?: string | null
          visibility?: string
        }
        Update: {
          category?: string
          city?: string
          created_at?: string
          delete_after?: string | null
          description?: string | null
          estimated_value?: number | null
          item_condition?: string | null
          listing_id?: string | null
          listing_world_slug?: string | null
          location_display_level?: string
          owner_id?: string
          post_id?: string
          reopen_count?: number
          search_vector?: unknown
          source_language?: string | null
          source_language_confidence?: number | null
          status?: string
          status_before_admin_removal?: string | null
          street?: string
          street_number?: string
          title?: string
          type?: string
          updated_at?: string
          urgency?: string | null
          visibility?: string
        }
        Relationships: [
          {
            foreignKeyName: "posts_city_fkey"
            columns: ["city"]
            isOneToOne: false
            referencedRelation: "cities"
            referencedColumns: ["city_id"]
          },
          {
            foreignKeyName: "posts_listing_id_fkey"
            columns: ["listing_id"]
            isOneToOne: false
            referencedRelation: "listings"
            referencedColumns: ["listing_id"]
          },
          {
            foreignKeyName: "posts_listing_id_fkey"
            columns: ["listing_id"]
            isOneToOne: false
            referencedRelation: "marketplace_listing_card"
            referencedColumns: ["listing_id"]
          },
          {
            foreignKeyName: "posts_listing_world_slug_fkey"
            columns: ["listing_world_slug"]
            isOneToOne: false
            referencedRelation: "worlds"
            referencedColumns: ["slug"]
          },
          {
            foreignKeyName: "posts_owner_id_fkey"
            columns: ["owner_id"]
            isOneToOne: false
            referencedRelation: "giving_user_trust_score"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "posts_owner_id_fkey"
            columns: ["owner_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "posts_owner_id_fkey"
            columns: ["owner_id"]
            isOneToOne: false
            referencedRelation: "users_public"
            referencedColumns: ["user_id"]
          },
        ]
      }
      profile_enrichments: {
        Row: {
          enrichments: Json
          updated_at: string
          user_id: string
        }
        Insert: {
          enrichments?: Json
          updated_at?: string
          user_id: string
        }
        Update: {
          enrichments?: Json
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "profile_enrichments_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: true
            referencedRelation: "giving_user_trust_score"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "profile_enrichments_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: true
            referencedRelation: "users"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "profile_enrichments_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: true
            referencedRelation: "users_public"
            referencedColumns: ["user_id"]
          },
        ]
      }
      provider_webhook_events: {
        Row: {
          created_at: string
          error_message: string | null
          payload: Json
          processed_at: string | null
          provider_event_id: string
          provider_slug: string
          status: string
          webhook_event_id: string
        }
        Insert: {
          created_at?: string
          error_message?: string | null
          payload: Json
          processed_at?: string | null
          provider_event_id: string
          provider_slug: string
          status?: string
          webhook_event_id?: string
        }
        Update: {
          created_at?: string
          error_message?: string | null
          payload?: Json
          processed_at?: string | null
          provider_event_id?: string
          provider_slug?: string
          status?: string
          webhook_event_id?: string
        }
        Relationships: []
      }
      public_research_contact_requests: {
        Row: {
          consent_at: string
          contact_email: string
          contact_window_he: string | null
          id: string
          response_id: string
        }
        Insert: {
          consent_at?: string
          contact_email: string
          contact_window_he?: string | null
          id?: string
          response_id: string
        }
        Update: {
          consent_at?: string
          contact_email?: string
          contact_window_he?: string | null
          id?: string
          response_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "public_research_contact_requests_response_id_fkey"
            columns: ["response_id"]
            isOneToOne: false
            referencedRelation: "public_research_responses"
            referencedColumns: ["id"]
          },
        ]
      }
      public_research_responses: {
        Row: {
          answers: Json
          created_at: string
          id: string
          ip_hash: string
          source: string
          survey_slug: string
          user_agent_hash: string | null
          version: number
        }
        Insert: {
          answers: Json
          created_at?: string
          id?: string
          ip_hash: string
          source?: string
          survey_slug: string
          user_agent_hash?: string | null
          version: number
        }
        Update: {
          answers?: Json
          created_at?: string
          id?: string
          ip_hash?: string
          source?: string
          survey_slug?: string
          user_agent_hash?: string | null
          version?: number
        }
        Relationships: []
      }
      rate_limit_buckets: {
        Row: {
          count: number
          key: string
          window_start: string
        }
        Insert: {
          count?: number
          key: string
          window_start: string
        }
        Update: {
          count?: number
          key?: string
          window_start?: string
        }
        Relationships: []
      }
      raw_records: {
        Row: {
          external_key: string | null
          fetched_at: string
          payload: Json
          record_id: string
          retain_until: string | null
          run_id: string
        }
        Insert: {
          external_key?: string | null
          fetched_at?: string
          payload: Json
          record_id?: string
          retain_until?: string | null
          run_id: string
        }
        Update: {
          external_key?: string | null
          fetched_at?: string
          payload?: Json
          record_id?: string
          retain_until?: string | null
          run_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "raw_records_run_id_fkey"
            columns: ["run_id"]
            isOneToOne: false
            referencedRelation: "ingestion_runs"
            referencedColumns: ["run_id"]
          },
        ]
      }
      recipients: {
        Row: {
          marked_at: string
          post_id: string
          recipient_user_id: string
        }
        Insert: {
          marked_at?: string
          post_id: string
          recipient_user_id: string
        }
        Update: {
          marked_at?: string
          post_id?: string
          recipient_user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "recipients_post_id_fkey"
            columns: ["post_id"]
            isOneToOne: true
            referencedRelation: "feed_visible_posts"
            referencedColumns: ["post_id"]
          },
          {
            foreignKeyName: "recipients_post_id_fkey"
            columns: ["post_id"]
            isOneToOne: true
            referencedRelation: "posts"
            referencedColumns: ["post_id"]
          },
          {
            foreignKeyName: "recipients_recipient_user_id_fkey"
            columns: ["recipient_user_id"]
            isOneToOne: false
            referencedRelation: "giving_user_trust_score"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "recipients_recipient_user_id_fkey"
            columns: ["recipient_user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "recipients_recipient_user_id_fkey"
            columns: ["recipient_user_id"]
            isOneToOne: false
            referencedRelation: "users_public"
            referencedColumns: ["user_id"]
          },
        ]
      }
      reporter_hides: {
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
            foreignKeyName: "reporter_hides_reporter_id_fkey"
            columns: ["reporter_id"]
            isOneToOne: false
            referencedRelation: "giving_user_trust_score"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "reporter_hides_reporter_id_fkey"
            columns: ["reporter_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "reporter_hides_reporter_id_fkey"
            columns: ["reporter_id"]
            isOneToOne: false
            referencedRelation: "users_public"
            referencedColumns: ["user_id"]
          },
        ]
      }
      reports: {
        Row: {
          created_at: string
          note: string | null
          reason: string
          report_id: string
          reporter_id: string
          resolved_at: string | null
          resolved_by: string | null
          sanction_consumed_at: string | null
          status: string
          target_id: string | null
          target_type: string
        }
        Insert: {
          created_at?: string
          note?: string | null
          reason: string
          report_id?: string
          reporter_id: string
          resolved_at?: string | null
          resolved_by?: string | null
          sanction_consumed_at?: string | null
          status?: string
          target_id?: string | null
          target_type: string
        }
        Update: {
          created_at?: string
          note?: string | null
          reason?: string
          report_id?: string
          reporter_id?: string
          resolved_at?: string | null
          resolved_by?: string | null
          sanction_consumed_at?: string | null
          status?: string
          target_id?: string | null
          target_type?: string
        }
        Relationships: [
          {
            foreignKeyName: "reports_reporter_id_fkey"
            columns: ["reporter_id"]
            isOneToOne: false
            referencedRelation: "giving_user_trust_score"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "reports_reporter_id_fkey"
            columns: ["reporter_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "reports_reporter_id_fkey"
            columns: ["reporter_id"]
            isOneToOne: false
            referencedRelation: "users_public"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "reports_resolved_by_fkey"
            columns: ["resolved_by"]
            isOneToOne: false
            referencedRelation: "giving_user_trust_score"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "reports_resolved_by_fkey"
            columns: ["resolved_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "reports_resolved_by_fkey"
            columns: ["resolved_by"]
            isOneToOne: false
            referencedRelation: "users_public"
            referencedColumns: ["user_id"]
          },
        ]
      }
      research_secrets: {
        Row: {
          key: string
          rotated_at: string
          value: string
        }
        Insert: {
          key: string
          rotated_at?: string
          value: string
        }
        Update: {
          key?: string
          rotated_at?: string
          value?: string
        }
        Relationships: []
      }
      ride_emergency_events: {
        Row: {
          event_id: string
          lat: number | null
          lng: number | null
          note: string | null
          resolved_at: string | null
          resolved_by: string | null
          ride_id: string
          triggered_at: string
          triggered_by: string
        }
        Insert: {
          event_id?: string
          lat?: number | null
          lng?: number | null
          note?: string | null
          resolved_at?: string | null
          resolved_by?: string | null
          ride_id: string
          triggered_at?: string
          triggered_by: string
        }
        Update: {
          event_id?: string
          lat?: number | null
          lng?: number | null
          note?: string | null
          resolved_at?: string | null
          resolved_by?: string | null
          ride_id?: string
          triggered_at?: string
          triggered_by?: string
        }
        Relationships: [
          {
            foreignKeyName: "ride_emergency_events_resolved_by_fkey"
            columns: ["resolved_by"]
            isOneToOne: false
            referencedRelation: "giving_user_trust_score"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "ride_emergency_events_resolved_by_fkey"
            columns: ["resolved_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "ride_emergency_events_resolved_by_fkey"
            columns: ["resolved_by"]
            isOneToOne: false
            referencedRelation: "users_public"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "ride_emergency_events_ride_id_fkey"
            columns: ["ride_id"]
            isOneToOne: false
            referencedRelation: "ride_listings"
            referencedColumns: ["ride_id"]
          },
          {
            foreignKeyName: "ride_emergency_events_triggered_by_fkey"
            columns: ["triggered_by"]
            isOneToOne: false
            referencedRelation: "giving_user_trust_score"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "ride_emergency_events_triggered_by_fkey"
            columns: ["triggered_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "ride_emergency_events_triggered_by_fkey"
            columns: ["triggered_by"]
            isOneToOne: false
            referencedRelation: "users_public"
            referencedColumns: ["user_id"]
          },
        ]
      }
      ride_listing_emergencies: {
        Row: {
          event_id: string
          listing_id: string
          note: string | null
          resolved_at: string | null
          resolved_by: string | null
          triggered_at: string
          triggered_by: string
        }
        Insert: {
          event_id?: string
          listing_id: string
          note?: string | null
          resolved_at?: string | null
          resolved_by?: string | null
          triggered_at?: string
          triggered_by: string
        }
        Update: {
          event_id?: string
          listing_id?: string
          note?: string | null
          resolved_at?: string | null
          resolved_by?: string | null
          triggered_at?: string
          triggered_by?: string
        }
        Relationships: [
          {
            foreignKeyName: "ride_listing_emergencies_listing_id_fkey"
            columns: ["listing_id"]
            isOneToOne: false
            referencedRelation: "listings"
            referencedColumns: ["listing_id"]
          },
          {
            foreignKeyName: "ride_listing_emergencies_listing_id_fkey"
            columns: ["listing_id"]
            isOneToOne: false
            referencedRelation: "marketplace_listing_card"
            referencedColumns: ["listing_id"]
          },
          {
            foreignKeyName: "ride_listing_emergencies_resolved_by_fkey"
            columns: ["resolved_by"]
            isOneToOne: false
            referencedRelation: "giving_user_trust_score"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "ride_listing_emergencies_resolved_by_fkey"
            columns: ["resolved_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "ride_listing_emergencies_resolved_by_fkey"
            columns: ["resolved_by"]
            isOneToOne: false
            referencedRelation: "users_public"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "ride_listing_emergencies_triggered_by_fkey"
            columns: ["triggered_by"]
            isOneToOne: false
            referencedRelation: "giving_user_trust_score"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "ride_listing_emergencies_triggered_by_fkey"
            columns: ["triggered_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "ride_listing_emergencies_triggered_by_fkey"
            columns: ["triggered_by"]
            isOneToOne: false
            referencedRelation: "users_public"
            referencedColumns: ["user_id"]
          },
        ]
      }
      ride_listings: {
        Row: {
          arrive_reason: string | null
          arrived_at: string | null
          cargo_allowed_types: string[] | null
          cargo_enabled: boolean
          cargo_max_volume_l: number | null
          cargo_max_weight_kg: number | null
          created_at: string
          departs_at: string
          description: string | null
          dest_city_id: string
          dest_street: string
          dest_street_number: string | null
          food_chilled: boolean | null
          food_handover_to_org: boolean
          food_max_kg: number | null
          food_shipping_enabled: boolean
          linked_post_id: string | null
          mode: string
          origin_city_id: string
          origin_street: string
          origin_street_number: string | null
          owner_id: string
          payment_amount_ils: number | null
          payment_model: string
          req_gender: string
          req_pets_allowed: boolean
          req_smoking_allowed: boolean
          req_verified_only: boolean
          ride_id: string
          seats_available: number | null
          started_at: string | null
          status: string
          template_id: string | null
          title: string
          updated_at: string
          visibility: string
        }
        Insert: {
          arrive_reason?: string | null
          arrived_at?: string | null
          cargo_allowed_types?: string[] | null
          cargo_enabled?: boolean
          cargo_max_volume_l?: number | null
          cargo_max_weight_kg?: number | null
          created_at?: string
          departs_at: string
          description?: string | null
          dest_city_id: string
          dest_street: string
          dest_street_number?: string | null
          food_chilled?: boolean | null
          food_handover_to_org?: boolean
          food_max_kg?: number | null
          food_shipping_enabled?: boolean
          linked_post_id?: string | null
          mode: string
          origin_city_id: string
          origin_street: string
          origin_street_number?: string | null
          owner_id: string
          payment_amount_ils?: number | null
          payment_model?: string
          req_gender?: string
          req_pets_allowed?: boolean
          req_smoking_allowed?: boolean
          req_verified_only?: boolean
          ride_id?: string
          seats_available?: number | null
          started_at?: string | null
          status?: string
          template_id?: string | null
          title: string
          updated_at?: string
          visibility?: string
        }
        Update: {
          arrive_reason?: string | null
          arrived_at?: string | null
          cargo_allowed_types?: string[] | null
          cargo_enabled?: boolean
          cargo_max_volume_l?: number | null
          cargo_max_weight_kg?: number | null
          created_at?: string
          departs_at?: string
          description?: string | null
          dest_city_id?: string
          dest_street?: string
          dest_street_number?: string | null
          food_chilled?: boolean | null
          food_handover_to_org?: boolean
          food_max_kg?: number | null
          food_shipping_enabled?: boolean
          linked_post_id?: string | null
          mode?: string
          origin_city_id?: string
          origin_street?: string
          origin_street_number?: string | null
          owner_id?: string
          payment_amount_ils?: number | null
          payment_model?: string
          req_gender?: string
          req_pets_allowed?: boolean
          req_smoking_allowed?: boolean
          req_verified_only?: boolean
          ride_id?: string
          seats_available?: number | null
          started_at?: string | null
          status?: string
          template_id?: string | null
          title?: string
          updated_at?: string
          visibility?: string
        }
        Relationships: [
          {
            foreignKeyName: "ride_listings_dest_city_id_fkey"
            columns: ["dest_city_id"]
            isOneToOne: false
            referencedRelation: "cities"
            referencedColumns: ["city_id"]
          },
          {
            foreignKeyName: "ride_listings_linked_post_id_fkey"
            columns: ["linked_post_id"]
            isOneToOne: false
            referencedRelation: "feed_visible_posts"
            referencedColumns: ["post_id"]
          },
          {
            foreignKeyName: "ride_listings_linked_post_id_fkey"
            columns: ["linked_post_id"]
            isOneToOne: false
            referencedRelation: "posts"
            referencedColumns: ["post_id"]
          },
          {
            foreignKeyName: "ride_listings_origin_city_id_fkey"
            columns: ["origin_city_id"]
            isOneToOne: false
            referencedRelation: "cities"
            referencedColumns: ["city_id"]
          },
          {
            foreignKeyName: "ride_listings_owner_id_fkey"
            columns: ["owner_id"]
            isOneToOne: false
            referencedRelation: "giving_user_trust_score"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "ride_listings_owner_id_fkey"
            columns: ["owner_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "ride_listings_owner_id_fkey"
            columns: ["owner_id"]
            isOneToOne: false
            referencedRelation: "users_public"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "ride_listings_template_id_fkey"
            columns: ["template_id"]
            isOneToOne: false
            referencedRelation: "ride_templates"
            referencedColumns: ["template_id"]
          },
        ]
      }
      ride_participants: {
        Row: {
          decided_at: string | null
          decided_by: string | null
          joined_active_at: string | null
          note: string | null
          participant_id: string
          requested_at: string
          ride_id: string
          status: string
          user_id: string
        }
        Insert: {
          decided_at?: string | null
          decided_by?: string | null
          joined_active_at?: string | null
          note?: string | null
          participant_id?: string
          requested_at?: string
          ride_id: string
          status?: string
          user_id: string
        }
        Update: {
          decided_at?: string | null
          decided_by?: string | null
          joined_active_at?: string | null
          note?: string | null
          participant_id?: string
          requested_at?: string
          ride_id?: string
          status?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "ride_participants_decided_by_fkey"
            columns: ["decided_by"]
            isOneToOne: false
            referencedRelation: "giving_user_trust_score"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "ride_participants_decided_by_fkey"
            columns: ["decided_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "ride_participants_decided_by_fkey"
            columns: ["decided_by"]
            isOneToOne: false
            referencedRelation: "users_public"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "ride_participants_ride_id_fkey"
            columns: ["ride_id"]
            isOneToOne: false
            referencedRelation: "ride_listings"
            referencedColumns: ["ride_id"]
          },
          {
            foreignKeyName: "ride_participants_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "giving_user_trust_score"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "ride_participants_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "ride_participants_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users_public"
            referencedColumns: ["user_id"]
          },
        ]
      }
      ride_ratings: {
        Row: {
          comment: string | null
          created_at: string
          is_penalty: boolean
          ratee_id: string
          rater_id: string
          rating_id: string
          ride_id: string
          stars: number
        }
        Insert: {
          comment?: string | null
          created_at?: string
          is_penalty?: boolean
          ratee_id: string
          rater_id: string
          rating_id?: string
          ride_id: string
          stars: number
        }
        Update: {
          comment?: string | null
          created_at?: string
          is_penalty?: boolean
          ratee_id?: string
          rater_id?: string
          rating_id?: string
          ride_id?: string
          stars?: number
        }
        Relationships: [
          {
            foreignKeyName: "ride_ratings_ratee_id_fkey"
            columns: ["ratee_id"]
            isOneToOne: false
            referencedRelation: "giving_user_trust_score"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "ride_ratings_ratee_id_fkey"
            columns: ["ratee_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "ride_ratings_ratee_id_fkey"
            columns: ["ratee_id"]
            isOneToOne: false
            referencedRelation: "users_public"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "ride_ratings_rater_id_fkey"
            columns: ["rater_id"]
            isOneToOne: false
            referencedRelation: "giving_user_trust_score"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "ride_ratings_rater_id_fkey"
            columns: ["rater_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "ride_ratings_rater_id_fkey"
            columns: ["rater_id"]
            isOneToOne: false
            referencedRelation: "users_public"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "ride_ratings_ride_id_fkey"
            columns: ["ride_id"]
            isOneToOne: false
            referencedRelation: "ride_listings"
            referencedColumns: ["ride_id"]
          },
        ]
      }
      ride_route_alerts: {
        Row: {
          created_at: string
          delivered_at: string | null
          listing_id: string
          route_id: string
          status: string
          user_id: string
        }
        Insert: {
          created_at?: string
          delivered_at?: string | null
          listing_id: string
          route_id: string
          status?: string
          user_id: string
        }
        Update: {
          created_at?: string
          delivered_at?: string | null
          listing_id?: string
          route_id?: string
          status?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "ride_route_alerts_listing_id_fkey"
            columns: ["listing_id"]
            isOneToOne: false
            referencedRelation: "listings"
            referencedColumns: ["listing_id"]
          },
          {
            foreignKeyName: "ride_route_alerts_listing_id_fkey"
            columns: ["listing_id"]
            isOneToOne: false
            referencedRelation: "marketplace_listing_card"
            referencedColumns: ["listing_id"]
          },
          {
            foreignKeyName: "ride_route_alerts_route_id_fkey"
            columns: ["route_id"]
            isOneToOne: false
            referencedRelation: "ride_saved_routes"
            referencedColumns: ["route_id"]
          },
          {
            foreignKeyName: "ride_route_alerts_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "giving_user_trust_score"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "ride_route_alerts_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "ride_route_alerts_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users_public"
            referencedColumns: ["user_id"]
          },
        ]
      }
      ride_saved_routes: {
        Row: {
          created_at: string
          dest_label: string
          dest_lat: number
          dest_lng: number
          dest_place_id: string
          dest_place_kind: string
          origin_label: string
          origin_lat: number
          origin_lng: number
          origin_place_id: string
          origin_place_kind: string
          radius_km: number
          route_id: string
          time_from: string | null
          time_to: string | null
          user_id: string
          wants: string
          weekdays: number | null
        }
        Insert: {
          created_at?: string
          dest_label: string
          dest_lat: number
          dest_lng: number
          dest_place_id: string
          dest_place_kind: string
          origin_label: string
          origin_lat: number
          origin_lng: number
          origin_place_id: string
          origin_place_kind: string
          radius_km?: number
          route_id?: string
          time_from?: string | null
          time_to?: string | null
          user_id?: string
          wants?: string
          weekdays?: number | null
        }
        Update: {
          created_at?: string
          dest_label?: string
          dest_lat?: number
          dest_lng?: number
          dest_place_id?: string
          dest_place_kind?: string
          origin_label?: string
          origin_lat?: number
          origin_lng?: number
          origin_place_id?: string
          origin_place_kind?: string
          radius_km?: number
          route_id?: string
          time_from?: string | null
          time_to?: string | null
          user_id?: string
          wants?: string
          weekdays?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "ride_saved_routes_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "giving_user_trust_score"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "ride_saved_routes_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "ride_saved_routes_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users_public"
            referencedColumns: ["user_id"]
          },
        ]
      }
      ride_stops: {
        Row: {
          city_id: string
          created_at: string
          notes: string | null
          ride_id: string
          sort_order: number
          stop_id: string
          street: string | null
        }
        Insert: {
          city_id: string
          created_at?: string
          notes?: string | null
          ride_id: string
          sort_order: number
          stop_id?: string
          street?: string | null
        }
        Update: {
          city_id?: string
          created_at?: string
          notes?: string | null
          ride_id?: string
          sort_order?: number
          stop_id?: string
          street?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "ride_stops_city_id_fkey"
            columns: ["city_id"]
            isOneToOne: false
            referencedRelation: "cities"
            referencedColumns: ["city_id"]
          },
          {
            foreignKeyName: "ride_stops_ride_id_fkey"
            columns: ["ride_id"]
            isOneToOne: false
            referencedRelation: "ride_listings"
            referencedColumns: ["ride_id"]
          },
        ]
      }
      ride_templates: {
        Row: {
          created_at: string
          depart_time: string
          description: string | null
          dest_city_id: string
          dest_street: string
          dest_street_number: string | null
          lookahead_days: number
          mode: string
          origin_city_id: string
          origin_street: string
          origin_street_number: string | null
          owner_id: string
          seats_available: number | null
          status: string
          template_id: string
          updated_at: string
          visibility: string
          weekday_mask: number
        }
        Insert: {
          created_at?: string
          depart_time: string
          description?: string | null
          dest_city_id: string
          dest_street: string
          dest_street_number?: string | null
          lookahead_days?: number
          mode: string
          origin_city_id: string
          origin_street: string
          origin_street_number?: string | null
          owner_id: string
          seats_available?: number | null
          status?: string
          template_id?: string
          updated_at?: string
          visibility?: string
          weekday_mask: number
        }
        Update: {
          created_at?: string
          depart_time?: string
          description?: string | null
          dest_city_id?: string
          dest_street?: string
          dest_street_number?: string | null
          lookahead_days?: number
          mode?: string
          origin_city_id?: string
          origin_street?: string
          origin_street_number?: string | null
          owner_id?: string
          seats_available?: number | null
          status?: string
          template_id?: string
          updated_at?: string
          visibility?: string
          weekday_mask?: number
        }
        Relationships: [
          {
            foreignKeyName: "ride_templates_dest_city_id_fkey"
            columns: ["dest_city_id"]
            isOneToOne: false
            referencedRelation: "cities"
            referencedColumns: ["city_id"]
          },
          {
            foreignKeyName: "ride_templates_origin_city_id_fkey"
            columns: ["origin_city_id"]
            isOneToOne: false
            referencedRelation: "cities"
            referencedColumns: ["city_id"]
          },
          {
            foreignKeyName: "ride_templates_owner_id_fkey"
            columns: ["owner_id"]
            isOneToOne: false
            referencedRelation: "giving_user_trust_score"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "ride_templates_owner_id_fkey"
            columns: ["owner_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "ride_templates_owner_id_fkey"
            columns: ["owner_id"]
            isOneToOne: false
            referencedRelation: "users_public"
            referencedColumns: ["user_id"]
          },
        ]
      }
      road_junctions: {
        Row: {
          junction_id: number
          kind: string
          lat: number
          lng: number
          name_ar: string | null
          name_en: string | null
          name_he: string
          roads: string | null
        }
        Insert: {
          junction_id: number
          kind: string
          lat: number
          lng: number
          name_ar?: string | null
          name_en?: string | null
          name_he: string
          roads?: string | null
        }
        Update: {
          junction_id?: number
          kind?: string
          lat?: number
          lng?: number
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
            isOneToOne: false
            referencedRelation: "feed_visible_posts"
            referencedColumns: ["post_id"]
          },
          {
            foreignKeyName: "saved_posts_post_id_fkey"
            columns: ["post_id"]
            isOneToOne: false
            referencedRelation: "posts"
            referencedColumns: ["post_id"]
          },
          {
            foreignKeyName: "saved_posts_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "giving_user_trust_score"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "saved_posts_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "saved_posts_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users_public"
            referencedColumns: ["user_id"]
          },
        ]
      }
      search_hashtags: {
        Row: {
          tag: string
          updated_at: string
          use_count: number
        }
        Insert: {
          tag: string
          updated_at?: string
          use_count?: number
        }
        Update: {
          tag?: string
          updated_at?: string
          use_count?: number
        }
        Relationships: []
      }
      social_rpc_explain_snapshots: {
        Row: {
          captured_at: string
          elapsed_ms: number | null
          notes: string | null
          plan_text: string
          rpc_name: string
          snapshot_id: string
        }
        Insert: {
          captured_at?: string
          elapsed_ms?: number | null
          notes?: string | null
          plan_text: string
          rpc_name: string
          snapshot_id?: string
        }
        Update: {
          captured_at?: string
          elapsed_ms?: number | null
          notes?: string | null
          plan_text?: string
          rpc_name?: string
          snapshot_id?: string
        }
        Relationships: []
      }
      standing_orders: {
        Row: {
          amount_ils: number
          cadence: string
          cancelled_at: string | null
          created_at: string
          idempotency_key: string
          next_charge_at: string | null
          order_id: string
          org_id: string
          provider_id: string | null
          provider_ref: string | null
          status: string
          user_id: string
        }
        Insert: {
          amount_ils: number
          cadence: string
          cancelled_at?: string | null
          created_at?: string
          idempotency_key: string
          next_charge_at?: string | null
          order_id?: string
          org_id: string
          provider_id?: string | null
          provider_ref?: string | null
          status?: string
          user_id: string
        }
        Update: {
          amount_ils?: number
          cadence?: string
          cancelled_at?: string | null
          created_at?: string
          idempotency_key?: string
          next_charge_at?: string | null
          order_id?: string
          org_id?: string
          provider_id?: string | null
          provider_ref?: string | null
          status?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "standing_orders_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["org_id"]
          },
          {
            foreignKeyName: "standing_orders_provider_id_fkey"
            columns: ["provider_id"]
            isOneToOne: false
            referencedRelation: "payment_providers"
            referencedColumns: ["provider_id"]
          },
          {
            foreignKeyName: "standing_orders_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "giving_user_trust_score"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "standing_orders_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "standing_orders_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users_public"
            referencedColumns: ["user_id"]
          },
        ]
      }
      stats_drift_events: {
        Row: {
          column_name: string
          detected_at: string
          drift_id: number
          new_value: number
          old_value: number
          run_id: number
          user_id: string
        }
        Insert: {
          column_name: string
          detected_at?: string
          drift_id?: number
          new_value: number
          old_value: number
          run_id: number
          user_id: string
        }
        Update: {
          column_name?: string
          detected_at?: string
          drift_id?: number
          new_value?: number
          old_value?: number
          run_id?: number
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "stats_drift_events_run_id_fkey"
            columns: ["run_id"]
            isOneToOne: false
            referencedRelation: "stats_recompute_runs"
            referencedColumns: ["run_id"]
          },
          {
            foreignKeyName: "stats_drift_events_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "giving_user_trust_score"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "stats_drift_events_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "stats_drift_events_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users_public"
            referencedColumns: ["user_id"]
          },
        ]
      }
      stats_recompute_runs: {
        Row: {
          drift_events: number
          run_at: string
          run_id: number
          users_processed: number
        }
        Insert: {
          drift_events: number
          run_at?: string
          run_id?: number
          users_processed: number
        }
        Update: {
          drift_events?: number
          run_at?: string
          run_id?: number
          users_processed?: number
        }
        Relationships: []
      }
      streets: {
        Row: {
          city_id: string
          geo: unknown
          name_he: string
          street_id: number
        }
        Insert: {
          city_id: string
          geo?: unknown
          name_he: string
          street_id: number
        }
        Update: {
          city_id?: string
          geo?: unknown
          name_he?: string
          street_id?: number
        }
        Relationships: [
          {
            foreignKeyName: "streets_city_id_fkey"
            columns: ["city_id"]
            isOneToOne: false
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
          id: string
          question_id: string
          rating: number | null
          survey_id: string
          updated_at: string
          user_id: string
          version: number
        }
        Insert: {
          answer_text?: string | null
          choice_key?: string | null
          created_at?: string
          id?: string
          question_id: string
          rating?: number | null
          survey_id: string
          updated_at?: string
          user_id: string
          version: number
        }
        Update: {
          answer_text?: string | null
          choice_key?: string | null
          created_at?: string
          id?: string
          question_id?: string
          rating?: number | null
          survey_id?: string
          updated_at?: string
          user_id?: string
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "survey_answers_question_id_fkey"
            columns: ["question_id"]
            isOneToOne: false
            referencedRelation: "survey_questions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "survey_answers_survey_id_fkey"
            columns: ["survey_id"]
            isOneToOne: false
            referencedRelation: "surveys"
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
          question_type: Database["public"]["Enums"]["survey_question_type"]
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
          question_type?: Database["public"]["Enums"]["survey_question_type"]
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
          question_type?: Database["public"]["Enums"]["survey_question_type"]
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
            isOneToOne: false
            referencedRelation: "survey_versions"
            referencedColumns: ["id"]
          },
        ]
      }
      survey_versions: {
        Row: {
          id: string
          published_at: string
          published_by: string
          survey_id: string
          version: number
        }
        Insert: {
          id?: string
          published_at?: string
          published_by: string
          survey_id: string
          version: number
        }
        Update: {
          id?: string
          published_at?: string
          published_by?: string
          survey_id?: string
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "survey_versions_survey_id_fkey"
            columns: ["survey_id"]
            isOneToOne: false
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
      timesheet_entries: {
        Row: {
          approval_note: string | null
          approved_at: string | null
          approved_by: string | null
          created_at: string
          deleted_at: string | null
          description: string | null
          entry_id: string
          hours_x100: number
          project: string | null
          status: string
          submitted_at: string | null
          updated_at: string
          user_id: string
          work_date: string
        }
        Insert: {
          approval_note?: string | null
          approved_at?: string | null
          approved_by?: string | null
          created_at?: string
          deleted_at?: string | null
          description?: string | null
          entry_id?: string
          hours_x100: number
          project?: string | null
          status?: string
          submitted_at?: string | null
          updated_at?: string
          user_id: string
          work_date: string
        }
        Update: {
          approval_note?: string | null
          approved_at?: string | null
          approved_by?: string | null
          created_at?: string
          deleted_at?: string | null
          description?: string | null
          entry_id?: string
          hours_x100?: number
          project?: string | null
          status?: string
          submitted_at?: string | null
          updated_at?: string
          user_id?: string
          work_date?: string
        }
        Relationships: [
          {
            foreignKeyName: "timesheet_entries_approved_by_fkey"
            columns: ["approved_by"]
            isOneToOne: false
            referencedRelation: "giving_user_trust_score"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "timesheet_entries_approved_by_fkey"
            columns: ["approved_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "timesheet_entries_approved_by_fkey"
            columns: ["approved_by"]
            isOneToOne: false
            referencedRelation: "users_public"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "timesheet_entries_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "giving_user_trust_score"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "timesheet_entries_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "timesheet_entries_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users_public"
            referencedColumns: ["user_id"]
          },
        ]
      }
      user_active_days: {
        Row: {
          active_on: string
          user_id: string
        }
        Insert: {
          active_on: string
          user_id: string
        }
        Update: {
          active_on?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_active_days_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "giving_user_trust_score"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "user_active_days_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "user_active_days_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users_public"
            referencedColumns: ["user_id"]
          },
        ]
      }
      user_entitlements: {
        Row: {
          active: boolean
          expires_at: string | null
          source: string
          tier: string
          updated_at: string
          user_id: string
        }
        Insert: {
          active?: boolean
          expires_at?: string | null
          source?: string
          tier?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          active?: boolean
          expires_at?: string | null
          source?: string
          tier?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_entitlements_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: true
            referencedRelation: "giving_user_trust_score"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "user_entitlements_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: true
            referencedRelation: "users"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "user_entitlements_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: true
            referencedRelation: "users_public"
            referencedColumns: ["user_id"]
          },
        ]
      }
      user_feed_cache: {
        Row: {
          post_ids: string[]
          refreshed_at: string
          user_id: string
        }
        Insert: {
          post_ids?: string[]
          refreshed_at?: string
          user_id: string
        }
        Update: {
          post_ids?: string[]
          refreshed_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_feed_cache_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: true
            referencedRelation: "giving_user_trust_score"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "user_feed_cache_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: true
            referencedRelation: "users"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "user_feed_cache_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: true
            referencedRelation: "users_public"
            referencedColumns: ["user_id"]
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
        Relationships: []
      }
      user_geo_prefs: {
        Row: {
          default_radius_km: number | null
          geo_mode: string | null
          geo_weight: number | null
          home_city_id: string | null
          home_geo: unknown
          updated_at: string
          user_id: string
        }
        Insert: {
          default_radius_km?: number | null
          geo_mode?: string | null
          geo_weight?: number | null
          home_city_id?: string | null
          home_geo?: unknown
          updated_at?: string
          user_id: string
        }
        Update: {
          default_radius_km?: number | null
          geo_mode?: string | null
          geo_weight?: number | null
          home_city_id?: string | null
          home_geo?: unknown
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_geo_prefs_home_city_id_fkey"
            columns: ["home_city_id"]
            isOneToOne: false
            referencedRelation: "cities"
            referencedColumns: ["city_id"]
          },
          {
            foreignKeyName: "user_geo_prefs_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: true
            referencedRelation: "giving_user_trust_score"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "user_geo_prefs_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: true
            referencedRelation: "users"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "user_geo_prefs_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: true
            referencedRelation: "users_public"
            referencedColumns: ["user_id"]
          },
        ]
      }
      user_legal_acceptances: {
        Row: {
          accepted_at: string
          doc_type: Database["public"]["Enums"]["legal_doc_type"]
          id: string
          ip_inet: unknown
          locale: string | null
          user_agent: string | null
          user_id: string
          version: number
        }
        Insert: {
          accepted_at?: string
          doc_type: Database["public"]["Enums"]["legal_doc_type"]
          id?: string
          ip_inet?: unknown
          locale?: string | null
          user_agent?: string | null
          user_id: string
          version: number
        }
        Update: {
          accepted_at?: string
          doc_type?: Database["public"]["Enums"]["legal_doc_type"]
          id?: string
          ip_inet?: unknown
          locale?: string | null
          user_agent?: string | null
          user_id?: string
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "user_legal_acceptances_version_fk"
            columns: ["doc_type", "version"]
            isOneToOne: false
            referencedRelation: "legal_document_versions"
            referencedColumns: ["doc_type", "version"]
          },
        ]
      }
      user_personal_activity_log: {
        Row: {
          actor_display_name: string | null
          kind: string
          log_id: number
          occurred_at: string
          post_id: string
          post_title: string
          subject_user_id: string
        }
        Insert: {
          actor_display_name?: string | null
          kind: string
          log_id?: number
          occurred_at: string
          post_id: string
          post_title: string
          subject_user_id: string
        }
        Update: {
          actor_display_name?: string | null
          kind?: string
          log_id?: number
          occurred_at?: string
          post_id?: string
          post_title?: string
          subject_user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_personal_activity_log_subject_user_id_fkey"
            columns: ["subject_user_id"]
            isOneToOne: false
            referencedRelation: "giving_user_trust_score"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "user_personal_activity_log_subject_user_id_fkey"
            columns: ["subject_user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "user_personal_activity_log_subject_user_id_fkey"
            columns: ["subject_user_id"]
            isOneToOne: false
            referencedRelation: "users_public"
            referencedColumns: ["user_id"]
          },
        ]
      }
      users: {
        Row: {
          account_status: string
          account_status_until: string | null
          active_posts_count_followers_only_open: number
          active_posts_count_internal: number
          active_posts_count_public_open: number
          auth_provider: string
          avatar_url: string | null
          basic_info_skipped: boolean
          biography: string | null
          city: string | null
          city_name: string | null
          closure_explainer_dismissed: boolean
          contact_phone: string | null
          created_at: string
          display_name: string | null
          false_report_sanction_count: number
          false_reports_count: number
          first_post_nudge_dismissed: boolean
          followers_count: number
          following_count: number
          food_posting_banned_until: string | null
          is_super_admin: boolean
          items_given_count: number
          items_received_count: number
          karma_points: number
          notification_preferences: Json
          onboarding_state: string
          posts_created_total: number
          preferred_language: string | null
          privacy_changed_at: string | null
          privacy_mode: string
          profile_street: string | null
          profile_street_number: string | null
          search_vector: unknown
          share_handle: string
          show_active_status: boolean
          updated_at: string
          user_id: string
          verification_method: string | null
          verified_at: string | null
          volunteer_hours_total: number
        }
        Insert: {
          account_status?: string
          account_status_until?: string | null
          active_posts_count_followers_only_open?: number
          active_posts_count_internal?: number
          active_posts_count_public_open?: number
          auth_provider: string
          avatar_url?: string | null
          basic_info_skipped?: boolean
          biography?: string | null
          city?: string | null
          city_name?: string | null
          closure_explainer_dismissed?: boolean
          contact_phone?: string | null
          created_at?: string
          display_name?: string | null
          false_report_sanction_count?: number
          false_reports_count?: number
          first_post_nudge_dismissed?: boolean
          followers_count?: number
          following_count?: number
          food_posting_banned_until?: string | null
          is_super_admin?: boolean
          items_given_count?: number
          items_received_count?: number
          karma_points?: number
          notification_preferences?: Json
          onboarding_state?: string
          posts_created_total?: number
          preferred_language?: string | null
          privacy_changed_at?: string | null
          privacy_mode?: string
          profile_street?: string | null
          profile_street_number?: string | null
          search_vector?: unknown
          share_handle: string
          show_active_status?: boolean
          updated_at?: string
          user_id: string
          verification_method?: string | null
          verified_at?: string | null
          volunteer_hours_total?: number
        }
        Update: {
          account_status?: string
          account_status_until?: string | null
          active_posts_count_followers_only_open?: number
          active_posts_count_internal?: number
          active_posts_count_public_open?: number
          auth_provider?: string
          avatar_url?: string | null
          basic_info_skipped?: boolean
          biography?: string | null
          city?: string | null
          city_name?: string | null
          closure_explainer_dismissed?: boolean
          contact_phone?: string | null
          created_at?: string
          display_name?: string | null
          false_report_sanction_count?: number
          false_reports_count?: number
          first_post_nudge_dismissed?: boolean
          followers_count?: number
          following_count?: number
          food_posting_banned_until?: string | null
          is_super_admin?: boolean
          items_given_count?: number
          items_received_count?: number
          karma_points?: number
          notification_preferences?: Json
          onboarding_state?: string
          posts_created_total?: number
          preferred_language?: string | null
          privacy_changed_at?: string | null
          privacy_mode?: string
          profile_street?: string | null
          profile_street_number?: string | null
          search_vector?: unknown
          share_handle?: string
          show_active_status?: boolean
          updated_at?: string
          user_id?: string
          verification_method?: string | null
          verified_at?: string | null
          volunteer_hours_total?: number
        }
        Relationships: [
          {
            foreignKeyName: "users_city_fkey"
            columns: ["city"]
            isOneToOne: false
            referencedRelation: "cities"
            referencedColumns: ["city_id"]
          },
        ]
      }
      volunteer_opportunities: {
        Row: {
          city_id: string | null
          created_at: string
          location_label: string | null
          opportunity_id: string
          org_id: string | null
          organizer_id: string
          status: string
          summary: string | null
          title: string
          updated_at: string
        }
        Insert: {
          city_id?: string | null
          created_at?: string
          location_label?: string | null
          opportunity_id?: string
          org_id?: string | null
          organizer_id: string
          status?: string
          summary?: string | null
          title: string
          updated_at?: string
        }
        Update: {
          city_id?: string | null
          created_at?: string
          location_label?: string | null
          opportunity_id?: string
          org_id?: string | null
          organizer_id?: string
          status?: string
          summary?: string | null
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "volunteer_opportunities_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["org_id"]
          },
          {
            foreignKeyName: "volunteer_opportunities_organizer_id_fkey"
            columns: ["organizer_id"]
            isOneToOne: false
            referencedRelation: "giving_user_trust_score"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "volunteer_opportunities_organizer_id_fkey"
            columns: ["organizer_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "volunteer_opportunities_organizer_id_fkey"
            columns: ["organizer_id"]
            isOneToOne: false
            referencedRelation: "users_public"
            referencedColumns: ["user_id"]
          },
        ]
      }
      volunteer_shift_signups: {
        Row: {
          checked_in_at: string | null
          hours_logged: number | null
          shift_id: string
          signed_up_at: string
          signup_id: string
          status: string
          user_id: string
          waitlist_position: number | null
        }
        Insert: {
          checked_in_at?: string | null
          hours_logged?: number | null
          shift_id: string
          signed_up_at?: string
          signup_id?: string
          status?: string
          user_id: string
          waitlist_position?: number | null
        }
        Update: {
          checked_in_at?: string | null
          hours_logged?: number | null
          shift_id?: string
          signed_up_at?: string
          signup_id?: string
          status?: string
          user_id?: string
          waitlist_position?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "volunteer_shift_signups_shift_id_fkey"
            columns: ["shift_id"]
            isOneToOne: false
            referencedRelation: "volunteer_shifts"
            referencedColumns: ["shift_id"]
          },
          {
            foreignKeyName: "volunteer_shift_signups_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "giving_user_trust_score"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "volunteer_shift_signups_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "volunteer_shift_signups_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users_public"
            referencedColumns: ["user_id"]
          },
        ]
      }
      volunteer_shifts: {
        Row: {
          capacity: number
          created_at: string
          ends_at: string
          opportunity_id: string
          shift_id: string
          starts_at: string
        }
        Insert: {
          capacity?: number
          created_at?: string
          ends_at: string
          opportunity_id: string
          shift_id?: string
          starts_at: string
        }
        Update: {
          capacity?: number
          created_at?: string
          ends_at?: string
          opportunity_id?: string
          shift_id?: string
          starts_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "volunteer_shifts_opportunity_id_fkey"
            columns: ["opportunity_id"]
            isOneToOne: false
            referencedRelation: "volunteer_opportunities"
            referencedColumns: ["opportunity_id"]
          },
        ]
      }
      whatsapp_channel_config: {
        Row: {
          config_id: string
          graph_api_version: string
          is_enabled: boolean
          phone_number_id: string | null
          source_id: string
          updated_at: string
        }
        Insert: {
          config_id?: string
          graph_api_version?: string
          is_enabled?: boolean
          phone_number_id?: string | null
          source_id: string
          updated_at?: string
        }
        Update: {
          config_id?: string
          graph_api_version?: string
          is_enabled?: boolean
          phone_number_id?: string | null
          source_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "whatsapp_channel_config_source_id_fkey"
            columns: ["source_id"]
            isOneToOne: true
            referencedRelation: "ingestion_sources"
            referencedColumns: ["source_id"]
          },
        ]
      }
      whatsapp_consent_events: {
        Row: {
          action: string
          created_at: string
          event_id: string
          keyword: string | null
          record_id: string | null
          source: string
          user_id: string | null
          wa_id: string | null
        }
        Insert: {
          action: string
          created_at?: string
          event_id?: string
          keyword?: string | null
          record_id?: string | null
          source: string
          user_id?: string | null
          wa_id?: string | null
        }
        Update: {
          action?: string
          created_at?: string
          event_id?: string
          keyword?: string | null
          record_id?: string | null
          source?: string
          user_id?: string | null
          wa_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "whatsapp_consent_events_record_id_fkey"
            columns: ["record_id"]
            isOneToOne: false
            referencedRelation: "raw_records"
            referencedColumns: ["record_id"]
          },
          {
            foreignKeyName: "whatsapp_consent_events_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "giving_user_trust_score"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "whatsapp_consent_events_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "whatsapp_consent_events_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users_public"
            referencedColumns: ["user_id"]
          },
        ]
      }
      whatsapp_identities: {
        Row: {
          consent_status: string
          consent_updated_at: string | null
          created_at: string
          identity_id: string
          last_inbound_at: string | null
          last_upsell_at: string | null
          preferred_language: string
          updated_at: string
          user_id: string | null
          wa_id: string
        }
        Insert: {
          consent_status?: string
          consent_updated_at?: string | null
          created_at?: string
          identity_id?: string
          last_inbound_at?: string | null
          last_upsell_at?: string | null
          preferred_language?: string
          updated_at?: string
          user_id?: string | null
          wa_id: string
        }
        Update: {
          consent_status?: string
          consent_updated_at?: string | null
          created_at?: string
          identity_id?: string
          last_inbound_at?: string | null
          last_upsell_at?: string | null
          preferred_language?: string
          updated_at?: string
          user_id?: string | null
          wa_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "whatsapp_identities_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "giving_user_trust_score"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "whatsapp_identities_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "whatsapp_identities_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users_public"
            referencedColumns: ["user_id"]
          },
        ]
      }
      whatsapp_inbound_claims: {
        Row: {
          claimed_at: string
          message_id: string
        }
        Insert: {
          claimed_at?: string
          message_id: string
        }
        Update: {
          claimed_at?: string
          message_id?: string
        }
        Relationships: []
      }
      whatsapp_link_codes: {
        Row: {
          code_hash: string
          created_at: string
          expires_at: string
          user_id: string
        }
        Insert: {
          code_hash: string
          created_at?: string
          expires_at: string
          user_id: string
        }
        Update: {
          code_hash?: string
          created_at?: string
          expires_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "whatsapp_link_codes_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: true
            referencedRelation: "giving_user_trust_score"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "whatsapp_link_codes_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: true
            referencedRelation: "users"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "whatsapp_link_codes_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: true
            referencedRelation: "users_public"
            referencedColumns: ["user_id"]
          },
        ]
      }
      whatsapp_link_failures: {
        Row: {
          failed_at: string
          wa_id: string
        }
        Insert: {
          failed_at?: string
          wa_id: string
        }
        Update: {
          failed_at?: string
          wa_id?: string
        }
        Relationships: []
      }
      whatsapp_match_consent: {
        Row: {
          opted_in: boolean
          opted_in_at: string | null
          opted_out_at: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          opted_in?: boolean
          opted_in_at?: string | null
          opted_out_at?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          opted_in?: boolean
          opted_in_at?: string | null
          opted_out_at?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "whatsapp_match_consent_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: true
            referencedRelation: "giving_user_trust_score"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "whatsapp_match_consent_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: true
            referencedRelation: "users"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "whatsapp_match_consent_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: true
            referencedRelation: "users_public"
            referencedColumns: ["user_id"]
          },
        ]
      }
      whatsapp_message_templates: {
        Row: {
          body_preview: string
          category: string
          created_at: string
          is_approved: boolean
          language_code: string
          meta_status: string
          meta_template_id: string | null
          params: Json
          registry_version: number | null
          template_id: string
          template_name: string
          updated_at: string
        }
        Insert: {
          body_preview: string
          category: string
          created_at?: string
          is_approved?: boolean
          language_code?: string
          meta_status?: string
          meta_template_id?: string | null
          params?: Json
          registry_version?: number | null
          template_id?: string
          template_name: string
          updated_at?: string
        }
        Update: {
          body_preview?: string
          category?: string
          created_at?: string
          is_approved?: boolean
          language_code?: string
          meta_status?: string
          meta_template_id?: string | null
          params?: Json
          registry_version?: number | null
          template_id?: string
          template_name?: string
          updated_at?: string
        }
        Relationships: []
      }
      whatsapp_rate_counters: {
        Row: {
          bucket: string
          hits: number
          window_start: string
        }
        Insert: {
          bucket: string
          hits?: number
          window_start: string
        }
        Update: {
          bucket?: string
          hits?: number
          window_start?: string
        }
        Relationships: []
      }
      whatsapp_send_limits: {
        Row: {
          backoff_base_seconds: number
          global_per_minute: number
          global_template_recipients_day: number
          id: boolean
          inbound_per_phone_minute: number
          llm_global_day: number
          llm_per_phone_day: number
          max_attempts: number
          per_user_day: number
          per_user_hour: number
          reply_per_phone_hour: number
          updated_at: string
        }
        Insert: {
          backoff_base_seconds?: number
          global_per_minute?: number
          global_template_recipients_day?: number
          id?: boolean
          inbound_per_phone_minute?: number
          llm_global_day?: number
          llm_per_phone_day?: number
          max_attempts?: number
          per_user_day?: number
          per_user_hour?: number
          reply_per_phone_hour?: number
          updated_at?: string
        }
        Update: {
          backoff_base_seconds?: number
          global_per_minute?: number
          global_template_recipients_day?: number
          id?: boolean
          inbound_per_phone_minute?: number
          llm_global_day?: number
          llm_per_phone_day?: number
          max_attempts?: number
          per_user_day?: number
          per_user_hour?: number
          reply_per_phone_hour?: number
          updated_at?: string
        }
        Relationships: []
      }
      world_links: {
        Row: {
          created_at: string
          description: string | null
          from_world_slug: string
          is_active: boolean
          label_en: string
          label_he: string
          link_id: string
          link_slug: string
          to_world_slug: string
        }
        Insert: {
          created_at?: string
          description?: string | null
          from_world_slug: string
          is_active?: boolean
          label_en: string
          label_he: string
          link_id?: string
          link_slug: string
          to_world_slug: string
        }
        Update: {
          created_at?: string
          description?: string | null
          from_world_slug?: string
          is_active?: boolean
          label_en?: string
          label_he?: string
          link_id?: string
          link_slug?: string
          to_world_slug?: string
        }
        Relationships: [
          {
            foreignKeyName: "world_links_from_world_slug_fkey"
            columns: ["from_world_slug"]
            isOneToOne: false
            referencedRelation: "worlds"
            referencedColumns: ["slug"]
          },
          {
            foreignKeyName: "world_links_to_world_slug_fkey"
            columns: ["to_world_slug"]
            isOneToOne: false
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
          feed_mirror: boolean
          geo_decay: number
          geo_mode: string
          geo_weight: number
          is_active: boolean
          label_en: string
          label_he: string
          prd_index: number
          requires_verification: boolean
          sensitivity: string
          slug: string
          sort_order: number
        }
        Insert: {
          created_at?: string
          default_anonymity_level?: number
          default_radius_km?: number
          default_ttl_hours?: number | null
          feed_mirror?: boolean
          geo_decay?: number
          geo_mode?: string
          geo_weight?: number
          is_active?: boolean
          label_en: string
          label_he: string
          prd_index: number
          requires_verification?: boolean
          sensitivity?: string
          slug: string
          sort_order?: number
        }
        Update: {
          created_at?: string
          default_anonymity_level?: number
          default_radius_km?: number
          default_ttl_hours?: number | null
          feed_mirror?: boolean
          geo_decay?: number
          geo_mode?: string
          geo_weight?: number
          is_active?: boolean
          label_en?: string
          label_he?: string
          prd_index?: number
          requires_verification?: boolean
          sensitivity?: string
          slug?: string
          sort_order?: number
        }
        Relationships: []
      }
    }
    Views: {
      about_team_profiles: {
        Row: {
          avatar_url: string | null
          display_name: string | null
          role_key: string | null
          share_handle: string | null
          sort_order: number | null
          user_id: string | null
        }
        Relationships: [
          {
            foreignKeyName: "about_team_members_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "giving_user_trust_score"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "about_team_members_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "about_team_members_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users_public"
            referencedColumns: ["user_id"]
          },
        ]
      }
      community_stats: {
        Row: {
          active_public_posts: number | null
          as_of: string | null
          items_delivered_total: number | null
          registered_users: number | null
        }
        Relationships: []
      }
      feed_visible_posts: {
        Row: {
          category: string | null
          city: string | null
          created_at: string | null
          delete_after: string | null
          description: string | null
          estimated_value: number | null
          item_condition: string | null
          listing_id: string | null
          listing_world_slug: string | null
          location_display_level: string | null
          owner_id: string | null
          post_id: string | null
          reopen_count: number | null
          search_vector: unknown
          source_language: string | null
          source_language_confidence: number | null
          status: string | null
          status_before_admin_removal: string | null
          street: string | null
          street_number: string | null
          title: string | null
          type: string | null
          updated_at: string | null
          urgency: string | null
          visibility: string | null
        }
        Insert: {
          category?: string | null
          city?: string | null
          created_at?: string | null
          delete_after?: string | null
          description?: string | null
          estimated_value?: number | null
          item_condition?: string | null
          listing_id?: string | null
          listing_world_slug?: string | null
          location_display_level?: string | null
          owner_id?: string | null
          post_id?: string | null
          reopen_count?: number | null
          search_vector?: unknown
          source_language?: string | null
          source_language_confidence?: number | null
          status?: string | null
          status_before_admin_removal?: string | null
          street?: string | null
          street_number?: string | null
          title?: string | null
          type?: string | null
          updated_at?: string | null
          urgency?: string | null
          visibility?: string | null
        }
        Update: {
          category?: string | null
          city?: string | null
          created_at?: string | null
          delete_after?: string | null
          description?: string | null
          estimated_value?: number | null
          item_condition?: string | null
          listing_id?: string | null
          listing_world_slug?: string | null
          location_display_level?: string | null
          owner_id?: string | null
          post_id?: string | null
          reopen_count?: number | null
          search_vector?: unknown
          source_language?: string | null
          source_language_confidence?: number | null
          status?: string | null
          status_before_admin_removal?: string | null
          street?: string | null
          street_number?: string | null
          title?: string | null
          type?: string | null
          updated_at?: string | null
          urgency?: string | null
          visibility?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "posts_city_fkey"
            columns: ["city"]
            isOneToOne: false
            referencedRelation: "cities"
            referencedColumns: ["city_id"]
          },
          {
            foreignKeyName: "posts_listing_id_fkey"
            columns: ["listing_id"]
            isOneToOne: false
            referencedRelation: "listings"
            referencedColumns: ["listing_id"]
          },
          {
            foreignKeyName: "posts_listing_id_fkey"
            columns: ["listing_id"]
            isOneToOne: false
            referencedRelation: "marketplace_listing_card"
            referencedColumns: ["listing_id"]
          },
          {
            foreignKeyName: "posts_listing_world_slug_fkey"
            columns: ["listing_world_slug"]
            isOneToOne: false
            referencedRelation: "worlds"
            referencedColumns: ["slug"]
          },
          {
            foreignKeyName: "posts_owner_id_fkey"
            columns: ["owner_id"]
            isOneToOne: false
            referencedRelation: "giving_user_trust_score"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "posts_owner_id_fkey"
            columns: ["owner_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "posts_owner_id_fkey"
            columns: ["owner_id"]
            isOneToOne: false
            referencedRelation: "users_public"
            referencedColumns: ["user_id"]
          },
        ]
      }
      giving_user_trust_score: {
        Row: {
          combined_trust_score: number | null
          handoff_trust_score: number | null
          match_trust_score: number | null
          user_id: string | null
        }
        Relationships: []
      }
      listing_owner_trust_score: {
        Row: {
          trust_score: number | null
          user_id: string | null
        }
        Relationships: [
          {
            foreignKeyName: "listings_owner_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "giving_user_trust_score"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "listings_owner_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "listings_owner_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users_public"
            referencedColumns: ["user_id"]
          },
        ]
      }
      marketplace_listing_card: {
        Row: {
          anonymity_level: number | null
          availability_status: string | null
          category_id: string | null
          city_id: string | null
          created_at: string | null
          details: Json | null
          direction: string | null
          expires_at: string | null
          geo: unknown
          kind_id: string | null
          kind_label_en: string | null
          kind_label_he: string | null
          kind_slug: string | null
          legacy_post_id: string | null
          legacy_ride_id: string | null
          listing_id: string | null
          origin: string | null
          owner_id: string | null
          published_at: string | null
          status: string | null
          summary: string | null
          time_window: unknown
          title: string | null
          updated_at: string | null
          urgency_level: number | null
          visibility: string | null
          world_label_en: string | null
          world_label_he: string | null
          world_slug: string | null
        }
        Relationships: [
          {
            foreignKeyName: "listings_category_id_fkey"
            columns: ["category_id"]
            isOneToOne: false
            referencedRelation: "categories"
            referencedColumns: ["category_id"]
          },
          {
            foreignKeyName: "listings_city_id_fkey"
            columns: ["city_id"]
            isOneToOne: false
            referencedRelation: "cities"
            referencedColumns: ["city_id"]
          },
          {
            foreignKeyName: "listings_kind_id_fkey"
            columns: ["kind_id"]
            isOneToOne: false
            referencedRelation: "listing_kinds"
            referencedColumns: ["kind_id"]
          },
          {
            foreignKeyName: "listings_legacy_post_id_fkey"
            columns: ["legacy_post_id"]
            isOneToOne: false
            referencedRelation: "feed_visible_posts"
            referencedColumns: ["post_id"]
          },
          {
            foreignKeyName: "listings_legacy_post_id_fkey"
            columns: ["legacy_post_id"]
            isOneToOne: false
            referencedRelation: "posts"
            referencedColumns: ["post_id"]
          },
          {
            foreignKeyName: "listings_legacy_ride_id_fkey"
            columns: ["legacy_ride_id"]
            isOneToOne: false
            referencedRelation: "ride_listings"
            referencedColumns: ["ride_id"]
          },
          {
            foreignKeyName: "listings_owner_id_fkey"
            columns: ["owner_id"]
            isOneToOne: false
            referencedRelation: "giving_user_trust_score"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "listings_owner_id_fkey"
            columns: ["owner_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "listings_owner_id_fkey"
            columns: ["owner_id"]
            isOneToOne: false
            referencedRelation: "users_public"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "listings_world_slug_fkey"
            columns: ["world_slug"]
            isOneToOne: false
            referencedRelation: "worlds"
            referencedColumns: ["slug"]
          },
        ]
      }
      user_legal_acceptances_latest: {
        Row: {
          accepted_at: string | null
          doc_type: Database["public"]["Enums"]["legal_doc_type"] | null
          user_id: string | null
          version: number | null
        }
        Relationships: [
          {
            foreignKeyName: "user_legal_acceptances_version_fk"
            columns: ["doc_type", "version"]
            isOneToOne: false
            referencedRelation: "legal_document_versions"
            referencedColumns: ["doc_type", "version"]
          },
        ]
      }
      user_ride_rating_summary: {
        Row: {
          avg_stars: number | null
          last_rated_at: string | null
          ratings_count: number | null
          user_id: string | null
        }
        Relationships: [
          {
            foreignKeyName: "ride_ratings_ratee_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "giving_user_trust_score"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "ride_ratings_ratee_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "ride_ratings_ratee_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users_public"
            referencedColumns: ["user_id"]
          },
        ]
      }
      users_public: {
        Row: {
          account_status: string | null
          auth_provider: string | null
          avatar_url: string | null
          basic_info_skipped: boolean | null
          biography: string | null
          city: string | null
          city_name: string | null
          closure_explainer_dismissed: boolean | null
          created_at: string | null
          display_name: string | null
          first_post_nudge_dismissed: boolean | null
          followers_count: number | null
          following_count: number | null
          items_given_count: number | null
          items_received_count: number | null
          onboarding_state: string | null
          privacy_changed_at: string | null
          privacy_mode: string | null
          share_handle: string | null
          updated_at: string | null
          user_id: string | null
        }
        Insert: {
          account_status?: string | null
          auth_provider?: string | null
          avatar_url?: string | null
          basic_info_skipped?: boolean | null
          biography?: string | null
          city?: string | null
          city_name?: string | null
          closure_explainer_dismissed?: boolean | null
          created_at?: string | null
          display_name?: string | null
          first_post_nudge_dismissed?: boolean | null
          followers_count?: number | null
          following_count?: number | null
          items_given_count?: number | null
          items_received_count?: number | null
          onboarding_state?: string | null
          privacy_changed_at?: string | null
          privacy_mode?: string | null
          share_handle?: string | null
          updated_at?: string | null
          user_id?: string | null
        }
        Update: {
          account_status?: string | null
          auth_provider?: string | null
          avatar_url?: string | null
          basic_info_skipped?: boolean | null
          biography?: string | null
          city?: string | null
          city_name?: string | null
          closure_explainer_dismissed?: boolean | null
          created_at?: string | null
          display_name?: string | null
          first_post_nudge_dismissed?: boolean | null
          followers_count?: number | null
          following_count?: number | null
          items_given_count?: number | null
          items_received_count?: number | null
          onboarding_state?: string | null
          privacy_changed_at?: string | null
          privacy_mode?: string | null
          share_handle?: string | null
          updated_at?: string | null
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "users_city_fkey"
            columns: ["city"]
            isOneToOne: false
            referencedRelation: "cities"
            referencedColumns: ["city_id"]
          },
        ]
      }
    }
    Functions: {
      _giving_handoff_from_listing: {
        Args: { p_listing_id: string }
        Returns: {
          details: Json
          listing_id: string
          owner_id: string
          status: string
          world_slug: string
        }[]
      }
      _volunteer_promote_waitlist: {
        Args: { p_shift_id: string }
        Returns: undefined
      }
      accept_legal_document: {
        Args: {
          p_doc_type: Database["public"]["Enums"]["legal_doc_type"]
          p_locale: string
          p_user_agent: string
          p_version: number
        }
        Returns: Json
      }
      active_posts_count_for_viewer: {
        Args: { p_owner: string; p_viewer: string }
        Returns: number
      }
      actor_scope_rank: {
        Args: { p_actor: string; p_scope: string }
        Returns: number
      }
      add_volunteer_shift: {
        Args: {
          p_capacity?: number
          p_ends_at: string
          p_opportunity_id: string
          p_starts_at: string
        }
        Returns: string
      }
      admin_assert_role: {
        Args: { allowed: string[]; uid: string }
        Returns: undefined
      }
      admin_audit_lookup: {
        Args: { p_limit?: number; p_user_id: string }
        Returns: {
          action: string
          actor_id: string | null
          created_at: string
          event_id: string
          metadata: Json | null
          target_id: string | null
          target_type: string | null
        }[]
        SetofOptions: {
          from: "*"
          to: "audit_events"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      admin_audit_lookup_guarded: {
        Args: { p_limit?: number; p_user_id: string }
        Returns: {
          action: string
          actor_id: string | null
          created_at: string
          event_id: string
          metadata: Json | null
          target_id: string | null
          target_type: string | null
        }[]
        SetofOptions: {
          from: "*"
          to: "audit_events"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      admin_audit_search: {
        Args: {
          p_action?: string
          p_actor_id?: string
          p_from?: string
          p_limit?: number
          p_offset?: number
          p_target_user_id?: string
          p_to?: string
        }
        Returns: {
          action: string
          actor_display_name: string
          actor_id: string
          created_at: string
          event_id: string
          metadata: Json
          target_display_name: string
          target_id: string
          target_type: string
          total_count: number
        }[]
      }
      admin_ban_user: {
        Args: { p_note: string; p_reason: string; p_target_user_id: string }
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
      admin_create_external_body: {
        Args: {
          p_body_type?: string
          p_contact_url?: string
          p_label_en: string
          p_label_he: string
          p_slug: string
          p_world_slug: string
        }
        Returns: string
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
          revoked_at: string
          revoked_by: string
          role: string
          scope_org_id: string
          user_id: string
        }[]
      }
      admin_list_external_bodies: {
        Args: { p_world_slug?: string }
        Returns: {
          body_id: string
          body_type: string
          contact_url: string | null
          created_at: string
          is_active: boolean
          is_verified: boolean
          label_en: string
          label_he: string
          requires_routing: boolean
          slug: string
          world_slug: string
        }[]
        SetofOptions: {
          from: "*"
          to: "external_bodies"
          isOneToOne: false
          isSetofReturn: true
        }
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
        Args: { p_application_id: string; p_note?: string }
        Returns: undefined
      }
      admin_org_application_decide: {
        Args: { p_application_id: string; p_approve: boolean; p_note?: string }
        Returns: undefined
      }
      admin_org_application_list: {
        Args: { p_limit?: number; p_offset?: number; p_status?: string }
        Returns: {
          applicant_name: string
          applicant_user_id: string
          application_id: string
          contact_email: string
          contact_phone: string
          created_at: string
          org_description: string
          org_name: string
          review_note: string
          reviewed_at: string
          reviewed_by: string
          reviewer_name: string
          status: string
          total_count: number
          website_url: string
        }[]
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
      admin_remove_listing: {
        Args: { p_listing_id: string }
        Returns: undefined
      }
      admin_remove_post: { Args: { p_post_id: string }; Returns: undefined }
      admin_restore_target: {
        Args: { p_target_id: string; p_target_type: string }
        Returns: undefined
      }
      admin_revoke_role: { Args: { p_grant_id: string }; Returns: undefined }
      admin_search_posts: {
        Args: {
          p_limit?: number
          p_offset?: number
          p_query?: string
          p_status?: string
        }
        Returns: {
          created_at: string
          owner_display_name: string
          owner_id: string
          post_id: string
          status: string
          title: string
          total_count: number
          type: string
          updated_at: string
          visibility: string
        }[]
      }
      admin_search_users: {
        Args: {
          p_limit?: number
          p_offset?: number
          p_query?: string
          p_status?: string
        }
        Returns: {
          account_status: string
          city_name: string
          created_at: string
          display_name: string
          last_seen_at: string
          share_handle: string
          total_count: number
          user_id: string
        }[]
      }
      admin_set_external_body_status: {
        Args: {
          p_body_id: string
          p_is_active?: boolean
          p_is_verified?: boolean
        }
        Returns: undefined
      }
      admin_set_manager: {
        Args: { p_grant_id: string; p_manager_grant_id?: string }
        Returns: undefined
      }
      admin_survey_overview: { Args: never; Returns: Json }
      admin_survey_results: { Args: { p_slug: string }; Returns: Json }
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
      admin_task_detail: {
        Args: { p_task_id: string }
        Returns: {
          activities: Json
          assignee_display_name: string
          assignee_id: string
          category: string
          created_at: string
          created_by: string
          created_by_display_name: string
          description: string
          due_at: string
          labels: string[]
          priority: string
          status: string
          task_id: string
          title: string
          updated_at: string
        }[]
      }
      admin_task_enqueue_assigned_notification: {
        Args: {
          p_actor_id: string
          p_assignee_id: string
          p_task_id: string
          p_title: string
        }
        Returns: undefined
      }
      admin_task_is_owner_or_assignee: {
        Args: { p_task_id: string; p_user_id: string }
        Returns: boolean
      }
      admin_task_list: {
        Args: {
          p_assignee?: string
          p_category?: string
          p_due_from?: string
          p_due_to?: string
          p_label?: string
          p_limit?: number
          p_offset?: number
          p_only_mine?: boolean
          p_overdue?: boolean
          p_priority?: string
          p_status?: string
          p_unassigned_only?: boolean
        }
        Returns: {
          assignee_display_name: string
          assignee_id: string
          category: string
          comment_count: number
          created_at: string
          created_by: string
          created_by_display_name: string
          description: string
          due_at: string
          labels: string[]
          priority: string
          status: string
          task_id: string
          title: string
          updated_at: string
        }[]
      }
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
        Args: { p_limit?: number; p_offset?: number }
        Returns: Json
      }
      anonymity_level_to_visibility: {
        Args: { p_level: number }
        Returns: string
      }
      api_bot_admin_review_enqueue: {
        Args: { p_extraction_id: string; p_reason: string }
        Returns: string
      }
      api_bot_admin_review_list: {
        Args: { p_limit?: number }
        Returns: {
          created_at: string
          extraction_id: string
          listing_id: string
          reason: string
          review_id: string
          status: string
        }[]
      }
      api_bot_admin_review_resolve: {
        Args: { p_review_id: string; p_reviewer_id: string; p_status: string }
        Returns: undefined
      }
      api_bot_apply_extraction: {
        Args: {
          p_confidence?: number
          p_details?: Json
          p_direction: string
          p_kind_slug: string
          p_session_id: string
          p_summary?: string
          p_title: string
          p_world_slug: string
        }
        Returns: string
      }
      api_bot_enqueue_match_notifications: {
        Args: { p_match_id: string }
        Returns: Json
      }
      api_bot_find_duplicate_listings: {
        Args: {
          p_limit?: number
          p_min_similarity?: number
          p_title: string
          p_world_slug: string
        }
        Returns: {
          listing_id: string
          owner_id: string
          similarity_score: number
          title: string
        }[]
      }
      api_bot_find_matches: {
        Args: { p_limit?: number; p_listing_id: string; p_owner_id: string }
        Returns: {
          candidate_listing_id: string
          fts_score: number
          geo_score: number
          match_status: string
          score: number
          trust_score: number
          vector_score: number
        }[]
      }
      api_bot_link_identity: {
        Args: { p_user_id: string; p_wa_id: string }
        Returns: string
      }
      api_bot_listing_cards: {
        Args: { p_ids: string[]; p_viewer_id: string }
        Returns: {
          city_id: string
          created_at: string
          direction: string
          listing_id: string
          summary: string
          title: string
          world_slug: string
        }[]
      }
      api_bot_my_listings: {
        Args: { p_limit?: number; p_user_id: string }
        Returns: {
          created_at: string
          direction: string
          listing_id: string
          title: string
          world_slug: string
        }[]
      }
      api_bot_my_matches: {
        Args: { p_limit?: number; p_user_id: string }
        Returns: {
          candidate_id: string
          distance_km: number
          my_listing_title: string
          other_listing_id: string
          other_title: string
          score: number
          status: string
          world_slug: string
        }[]
      }
      api_bot_open_session: {
        Args: { p_record_id?: string; p_wa_id: string }
        Returns: string
      }
      api_bot_publish_listing: {
        Args: { p_owner_id: string; p_session_id: string }
        Returns: string
      }
      api_bot_record_match_response: {
        Args: { p_match_id: string; p_response: string; p_user_id: string }
        Returns: string
      }
      api_bot_register_er_candidate: {
        Args: {
          p_listing_id_a: string
          p_listing_id_b: string
          p_reason?: string
          p_score: number
        }
        Returns: string
      }
      api_bot_search_listings: {
        Args: {
          p_limit?: number
          p_owner_id: string
          p_query: string
          p_world_slug?: string
        }
        Returns: {
          fts_rank: number
          geo_rank: number
          listing_id: string
          rrf_score: number
          trgm_rank: number
          vector_rank: number
        }[]
      }
      api_bot_set_match_consent: {
        Args: { p_opted_in: boolean; p_user_id: string }
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
        Returns: boolean
      }
      api_my_pro_status: { Args: never; Returns: Json }
      api_revenuecat_set_pro: {
        Args: { p_active: boolean; p_expires_at: string; p_user_id: string }
        Returns: Json
      }
      api_set_pro_entitlement: {
        Args: {
          p_active: boolean
          p_expires_at?: string
          p_source?: string
          p_user_id: string
        }
        Returns: undefined
      }
      api_whatsapp_admin_block_user: {
        Args: { p_user_id: string }
        Returns: undefined
      }
      api_whatsapp_admin_get_channel: { Args: never; Returns: Json }
      api_whatsapp_admin_list_consent: {
        Args: { p_limit?: number; p_offset?: number }
        Returns: {
          consent_status: string
          last_inbound_at: string
          opted_in: boolean
          opted_in_at: string
          opted_out_at: string
          preferred_language: string
          total_count: number
          updated_at: string
          user_id: string
          wa_id_masked: string
        }[]
      }
      api_whatsapp_admin_list_conversations: {
        Args: { p_limit?: number }
        Returns: {
          created_at: string
          listing_id: string
          session_id: string
          state: string
          updated_at: string
          user_id: string
          wa_id_masked: string
        }[]
      }
      api_whatsapp_admin_list_outbound: {
        Args: { p_limit?: number; p_offset?: number; p_status?: string }
        Returns: {
          attempts: number
          created_at: string
          kind: string
          language: string
          last_error: string
          next_attempt_at: string
          outbound_id: string
          sent_at: string
          status: string
          template_name: string
          total_count: number
          user_id: string
          wa_id_masked: string
        }[]
      }
      api_whatsapp_admin_list_rate_hits: {
        Args: { p_limit?: number }
        Returns: {
          bucket: string
          hits: number
          window_start: string
        }[]
      }
      api_whatsapp_admin_list_recent_matches: {
        Args: { p_limit?: number }
        Returns: {
          created_at: string
          language: string
          outbound_id: string
          payload: Json
          sent_at: string
          status: string
          user_id: string
          wa_id_masked: string
        }[]
      }
      api_whatsapp_admin_overview: { Args: never; Returns: Json }
      api_whatsapp_admin_resend: {
        Args: { p_outbound_id: string }
        Returns: string
      }
      api_whatsapp_admin_set_channel_enabled: {
        Args: { p_enabled: boolean }
        Returns: Json
      }
      api_whatsapp_bot_access: { Args: { p_wa_id: string }; Returns: Json }
      api_whatsapp_claim_inbound: {
        Args: { p_message_id: string }
        Returns: boolean
      }
      api_whatsapp_create_link_code: { Args: never; Returns: Json }
      api_whatsapp_handle_keyword: {
        Args: { p_record_id?: string; p_text: string; p_wa_id: string }
        Returns: Json
      }
      api_whatsapp_inbound_allowed: {
        Args: { p_wa_id: string }
        Returns: boolean
      }
      api_whatsapp_ingest_inbound: {
        Args: { p_message_id: string; p_payload: Json; p_run_id?: string }
        Returns: string
      }
      api_whatsapp_llm_budget_take: {
        Args: { p_wa_id: string }
        Returns: boolean
      }
      api_whatsapp_my_link_status: { Args: never; Returns: Json }
      api_whatsapp_outbound_claim: {
        Args: { p_batch?: number; p_visibility_seconds?: number }
        Returns: {
          attempts: number
          body: string | null
          channel: string
          claimed_at: string | null
          created_at: string
          kind: string
          language: string
          last_error: string | null
          next_attempt_at: string
          outbound_id: string
          payload: Json
          queue_msg_id: number | null
          sent_at: string | null
          status: string
          template_name: string | null
          to_wa_id: string | null
          user_id: string | null
          wa_message_id: string | null
        }[]
        SetofOptions: {
          from: "*"
          to: "bot_outbound_messages"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      api_whatsapp_outbound_log: {
        Args: { p_payload: Json; p_template_name: string; p_user_id: string }
        Returns: string
      }
      api_whatsapp_outbound_result: {
        Args: {
          p_error?: string
          p_ok: boolean
          p_outbound_id: string
          p_retryable?: boolean
          p_wa_message_id?: string
        }
        Returns: string
      }
      api_whatsapp_queue_outbound: {
        Args: {
          p_max_per_hour?: number
          p_payload: Json
          p_template_name: string
          p_user_id: string
        }
        Returns: string
      }
      api_whatsapp_queue_reply: {
        Args: { p_body: string; p_reply_kind?: string; p_wa_id: string }
        Returns: string
      }
      api_whatsapp_rate_counters_prune: {
        Args: { p_older_than?: string }
        Returns: number
      }
      api_whatsapp_redeem_link_code: {
        Args: { p_code: string; p_wa_id: string }
        Returns: Json
      }
      api_whatsapp_release_inbound: {
        Args: { p_message_id: string }
        Returns: undefined
      }
      api_whatsapp_unlink_me: { Args: never; Returns: undefined }
      attach_listing_media: {
        Args: { p_listing_id: string; p_storage_paths: string[] }
        Returns: undefined
      }
      auth_check_account_gate: {
        Args: { p_user_id: string }
        Returns: {
          allowed: boolean
          reason: string
          until_at: string
        }[]
      }
      book_knowledge_slot: {
        Args: { p_listing_id: string }
        Returns: {
          cancel_reason: string | null
          cancelled_at: string | null
          confirm_by: string | null
          confirmed_at: string | null
          handed_over_at: string | null
          handoff_id: string
          listing_id: string
          no_show_at: string | null
          owner_id: string
          pickup_mode: string
          pickup_window_end: string | null
          pickup_window_start: string | null
          recipient_id: string
          reserved_at: string
          seats: number
          slot_ends_at: string | null
          slot_starts_at: string | null
          status: string
          world_slug: string
        }
        SetofOptions: {
          from: "*"
          to: "giving_handoffs"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      book_ride_seat: {
        Args: { p_listing_id: string; p_seats?: number }
        Returns: {
          cancel_reason: string | null
          cancelled_at: string | null
          confirm_by: string | null
          confirmed_at: string | null
          handed_over_at: string | null
          handoff_id: string
          listing_id: string
          no_show_at: string | null
          owner_id: string
          pickup_mode: string
          pickup_window_end: string | null
          pickup_window_start: string | null
          recipient_id: string
          reserved_at: string
          seats: number
          slot_ends_at: string | null
          slot_starts_at: string | null
          status: string
          world_slug: string
        }
        SetofOptions: {
          from: "*"
          to: "giving_handoffs"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      browse_listings: {
        Args: {
          p_availability?: string
          p_category_id?: string
          p_cursor_created_at?: string
          p_cursor_id?: string
          p_cursor_sort?: number
          p_cursor_urgency?: number
          p_direction?: string
          p_lat?: number
          p_limit?: number
          p_lng?: number
          p_offset?: number
          p_radius_km?: number
          p_urgency_min?: number
          p_viewer?: string
          p_world_slug?: string
        }
        Returns: {
          availability_status: string
          city_id: string
          created_at: string
          direction: string
          distance_km: number
          geo: unknown
          kind_slug: string
          listing_id: string
          sort_key: number
          summary: string
          title: string
          urgency_level: number
          world_slug: string
        }[]
      }
      can_contact_support: { Args: { uid: string }; Returns: boolean }
      can_grant_role: {
        Args: { granter_uid: string; target_role: string; target_scope: string }
        Returns: boolean
      }
      can_manage_grant: {
        Args: { p_actor: string; p_grant_id: string }
        Returns: boolean
      }
      cancel_giving_handoff: {
        Args: { p_handoff_id: string }
        Returns: undefined
      }
      cancel_ride_booking: {
        Args: { p_handoff_id: string }
        Returns: {
          cancel_reason: string | null
          cancelled_at: string | null
          confirm_by: string | null
          confirmed_at: string | null
          handed_over_at: string | null
          handoff_id: string
          listing_id: string
          no_show_at: string | null
          owner_id: string
          pickup_mode: string
          pickup_window_end: string | null
          pickup_window_start: string | null
          recipient_id: string
          reserved_at: string
          seats: number
          slot_ends_at: string | null
          slot_starts_at: string | null
          status: string
          world_slug: string
        }
        SetofOptions: {
          from: "*"
          to: "giving_handoffs"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      cancel_standing_order: {
        Args: { p_order_id: string }
        Returns: {
          amount_ils: number
          cadence: string
          cancelled_at: string | null
          created_at: string
          idempotency_key: string
          next_charge_at: string | null
          order_id: string
          org_id: string
          provider_id: string | null
          provider_ref: string | null
          status: string
          user_id: string
        }
        SetofOptions: {
          from: "*"
          to: "standing_orders"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      cancel_volunteer_signup: {
        Args: { p_signup_id: string }
        Returns: undefined
      }
      chat_media_path_chat_ids: { Args: { p_name: string }; Returns: string[] }
      check_in_volunteer_shift: { Args: { p_signup_id: string }; Returns: Json }
      check_survey_prompt_eligibility: {
        Args: { p_session_count: number; p_slug: string }
        Returns: Json
      }
      claim_food_giving: {
        Args: {
          p_listing_id: string
          p_pickup_window_end?: string
          p_pickup_window_start?: string
        }
        Returns: {
          cancel_reason: string | null
          cancelled_at: string | null
          confirm_by: string | null
          confirmed_at: string | null
          handed_over_at: string | null
          handoff_id: string
          listing_id: string
          no_show_at: string | null
          owner_id: string
          pickup_mode: string
          pickup_window_end: string | null
          pickup_window_start: string | null
          recipient_id: string
          reserved_at: string
          seats: number
          slot_ends_at: string | null
          slot_starts_at: string | null
          status: string
          world_slug: string
        }
        SetofOptions: {
          from: "*"
          to: "giving_handoffs"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      close_post_with_recipient: {
        Args: { p_post_id: string; p_recipient_user_id: string }
        Returns: {
          category: string
          city: string
          created_at: string
          delete_after: string | null
          description: string | null
          estimated_value: number | null
          item_condition: string | null
          listing_id: string | null
          listing_world_slug: string | null
          location_display_level: string
          owner_id: string
          post_id: string
          reopen_count: number
          search_vector: unknown
          source_language: string | null
          source_language_confidence: number | null
          status: string
          status_before_admin_removal: string | null
          street: string
          street_number: string
          title: string
          type: string
          updated_at: string
          urgency: string | null
          visibility: string
        }
        SetofOptions: {
          from: "*"
          to: "posts"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      close_volunteer_opportunity: {
        Args: { p_opportunity_id: string }
        Returns: undefined
      }
      closure_cleanup_expired: { Args: never; Returns: number }
      closure_cleanup_expired_with_metric: { Args: never; Returns: number }
      complete_knowledge_session: {
        Args: { p_handoff_id: string }
        Returns: {
          cancel_reason: string | null
          cancelled_at: string | null
          confirm_by: string | null
          confirmed_at: string | null
          handed_over_at: string | null
          handoff_id: string
          listing_id: string
          no_show_at: string | null
          owner_id: string
          pickup_mode: string
          pickup_window_end: string | null
          pickup_window_start: string | null
          recipient_id: string
          reserved_at: string
          seats: number
          slot_ends_at: string | null
          slot_starts_at: string | null
          status: string
          world_slug: string
        }
        SetofOptions: {
          from: "*"
          to: "giving_handoffs"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      complete_ride_trip: {
        Args: { p_handoff_id: string }
        Returns: {
          cancel_reason: string | null
          cancelled_at: string | null
          confirm_by: string | null
          confirmed_at: string | null
          handed_over_at: string | null
          handoff_id: string
          listing_id: string
          no_show_at: string | null
          owner_id: string
          pickup_mode: string
          pickup_window_end: string | null
          pickup_window_start: string | null
          recipient_id: string
          reserved_at: string
          seats: number
          slot_ends_at: string | null
          slot_starts_at: string | null
          status: string
          world_slug: string
        }
        SetofOptions: {
          from: "*"
          to: "giving_handoffs"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      complete_sandbox_donation: {
        Args: { p_intent_id: string }
        Returns: Json
      }
      confirm_item_handoff: {
        Args: { p_handoff_id: string }
        Returns: {
          cancel_reason: string | null
          cancelled_at: string | null
          confirm_by: string | null
          confirmed_at: string | null
          handed_over_at: string | null
          handoff_id: string
          listing_id: string
          no_show_at: string | null
          owner_id: string
          pickup_mode: string
          pickup_window_end: string | null
          pickup_window_start: string | null
          recipient_id: string
          reserved_at: string
          seats: number
          slot_ends_at: string | null
          slot_starts_at: string | null
          status: string
          world_slug: string
        }
        SetofOptions: {
          from: "*"
          to: "giving_handoffs"
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
          handed_over_at: string | null
          handoff_id: string
          listing_id: string
          no_show_at: string | null
          owner_id: string
          pickup_mode: string
          pickup_window_end: string | null
          pickup_window_start: string | null
          recipient_id: string
          reserved_at: string
          seats: number
          slot_ends_at: string | null
          slot_starts_at: string | null
          status: string
          world_slug: string
        }
        SetofOptions: {
          from: "*"
          to: "giving_handoffs"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      create_donation_intent: {
        Args: {
          p_amount_ils: number
          p_idempotency_key: string
          p_listing_id?: string
          p_org_id: string
        }
        Returns: {
          amount_ils: number
          checkout_url: string | null
          created_at: string
          currency: string
          idempotency_key: string
          intent_id: string
          listing_id: string | null
          org_id: string
          provider_id: string | null
          provider_ref: string | null
          status: string
          updated_at: string
          user_id: string | null
        }
        SetofOptions: {
          from: "*"
          to: "donation_intents"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      create_marketplace_listing: {
        Args: {
          p_availability_status?: string
          p_category_id?: string
          p_city_id?: string
          p_details?: Json
          p_direction?: string
          p_external_body_id?: string
          p_kind_id: string
          p_lat?: number
          p_lng?: number
          p_max_radius_km?: number
          p_media_paths?: string[]
          p_summary?: string
          p_title: string
          p_urgency_level?: number
        }
        Returns: string
      }
      create_standing_order: {
        Args: {
          p_amount_ils: number
          p_cadence?: string
          p_idempotency_key: string
          p_org_id: string
        }
        Returns: {
          amount_ils: number
          cadence: string
          cancelled_at: string | null
          created_at: string
          idempotency_key: string
          next_charge_at: string | null
          order_id: string
          org_id: string
          provider_id: string | null
          provider_ref: string | null
          status: string
          user_id: string
        }
        SetofOptions: {
          from: "*"
          to: "standing_orders"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      create_volunteer_opportunity: {
        Args: {
          p_city_id?: string
          p_location_label?: string
          p_org_id?: string
          p_summary?: string
          p_title: string
        }
        Returns: string
      }
      crm_contact_delete: { Args: { p_contact_id: string }; Returns: undefined }
      crm_contact_list: {
        Args: {
          p_limit?: number
          p_offset?: number
          p_query?: string
          p_status?: string
          p_tag?: string
        }
        Returns: {
          contact_id: string
          created_at: string
          email: string
          last_contacted_at: string
          name: string
          notes: string
          organization: string
          phone: string
          role_title: string
          status: string
          tags: string[]
          total_count: number
          updated_at: string
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
          p_organization?: string
          p_phone?: string
          p_role_title?: string
          p_status?: string
          p_tags?: string[]
        }
        Returns: string
      }
      cron_feed_cache_worker: { Args: never; Returns: number }
      cron_refresh_feed_open_posts_mv_if_dirty: { Args: never; Returns: number }
      decline_ride_booking: {
        Args: { p_handoff_id: string }
        Returns: {
          cancel_reason: string | null
          cancelled_at: string | null
          confirm_by: string | null
          confirmed_at: string | null
          handed_over_at: string | null
          handoff_id: string
          listing_id: string
          no_show_at: string | null
          owner_id: string
          pickup_mode: string
          pickup_window_end: string | null
          pickup_window_start: string | null
          recipient_id: string
          reserved_at: string
          seats: number
          slot_ends_at: string | null
          slot_starts_at: string | null
          status: string
          world_slug: string
        }
        SetofOptions: {
          from: "*"
          to: "giving_handoffs"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      delete_account_data: { Args: never; Returns: Json }
      delete_my_listing: { Args: { p_listing_id: string }; Returns: undefined }
      drop_feed_impressions_partitions_older_than: {
        Args: { p_retention?: string }
        Returns: number
      }
      effective_geo: {
        Args: {
          p_listing: Database["public"]["Tables"]["listings"]["Row"]
          p_viewer?: string
        }
        Returns: {
          anchor_geo: unknown
          geo_mode: string
          geo_weight: number
          radius_km: number
        }[]
      }
      enforce_rate_limit: {
        Args: { p_key: string; p_max: number; p_window_seconds: number }
        Returns: undefined
      }
      enqueue_notification: {
        Args: {
          p_body_args?: Json
          p_body_key: string
          p_bypass_preferences?: boolean
          p_category: string
          p_data?: Json
          p_dedupe_key?: string
          p_kind: string
          p_title_key: string
          p_user_id: string
        }
        Returns: string
      }
      ensure_feed_impressions_month_partition: {
        Args: { p_at?: string }
        Returns: string
      }
      escape_ilike: { Args: { p: string }; Returns: string }
      feed_cache_enqueue: { Args: { p_user_id: string }; Returns: number }
      feed_cache_enqueue_active_users: {
        Args: { p_limit?: number }
        Returns: number
      }
      feed_cache_process_queue: { Args: { p_batch?: number }; Returns: number }
      feed_cache_refresh_user: { Args: { p_user_id: string }; Returns: number }
      feed_newest_explain_analyze_ms: {
        Args: { p_viewer_id?: string }
        Returns: Json
      }
      feed_ranked_ids: {
        Args: {
          p_cursor_created_at?: string
          p_cursor_distance?: number
          p_cursor_post_id?: string
          p_cursor_rank_score?: number
          p_filter_categories?: string[]
          p_filter_center_city?: string
          p_filter_item_conditions?: string[]
          p_filter_radius_km?: number
          p_filter_search_query?: string
          p_filter_status?: string
          p_filter_type?: string
          p_followers_only?: boolean
          p_page_limit?: number
          p_proximity_sort_city?: string
          p_sort_order?: string
          p_viewer_id: string
        }
        Returns: {
          distance_km: number
          post_id: string
          rank_score: number
        }[]
      }
      finance_ledger_delete: {
        Args: { p_entry_id: string }
        Returns: undefined
      }
      finance_ledger_list: {
        Args: {
          p_direction?: string
          p_from?: string
          p_kind?: string
          p_limit?: number
          p_offset?: number
          p_status?: string
          p_to?: string
        }
        Returns: {
          amount_cents: number
          category: string
          counterparty: string
          created_at: string
          currency: string
          description: string
          direction: string
          entry_id: string
          kind: string
          occurred_at: string
          reference_url: string
          status: string
          total_count: number
          updated_at: string
        }[]
      }
      finance_ledger_summary: {
        Args: { p_from?: string; p_to?: string }
        Returns: {
          currency: string
          entry_count: number
          expense_cents: number
          income_cents: number
          net_cents: number
        }[]
      }
      finance_ledger_upsert: {
        Args: {
          p_amount_cents?: number
          p_category?: string
          p_counterparty?: string
          p_currency?: string
          p_description?: string
          p_entry_id?: string
          p_kind?: string
          p_occurred_at?: string
          p_reference_url?: string
          p_status?: string
        }
        Returns: string
      }
      find_matches: {
        Args: { p_limit?: number; p_listing_id: string; p_viewer?: string }
        Returns: {
          candidate_listing_id: string
          fts_score: number
          geo_score: number
          match_status: string
          score: number
          trust_score: number
          vector_score: number
        }[]
      }
      find_or_create_support_chat: { Args: { p_user: string }; Returns: string }
      find_ride_listing_matches: {
        Args: {
          p_departs_after?: string
          p_departs_before?: string
          p_dest_lat: number
          p_dest_lng: number
          p_limit?: number
          p_origin_lat: number
          p_origin_lng: number
          p_radius_km?: number
        }
        Returns: {
          departs_at: string
          dest_label: string
          direction: string
          distance_m: number
          listing_id: string
          origin_label: string
          seats_left: number
          title: string
        }[]
      }
      food_expired_listings_sweep: { Args: never; Returns: number }
      food_listing_urgency_level: {
        Args: { p_expires_at: string }
        Returns: number
      }
      fulfill_my_listing: { Args: { p_listing_id: string }; Returns: undefined }
      get_chat_counterparty_contact: {
        Args: { p_chat_id: string }
        Returns: string
      }
      get_donation_receipt: { Args: { p_payment_id: string }; Returns: Json }
      get_listing_handoff: { Args: { p_listing_id: string }; Returns: Json }
      get_marketplace_listing_detail: {
        Args: { p_listing_id: string }
        Returns: Json
      }
      get_my_admin_roles: { Args: never; Returns: string[] }
      get_nonprofit_public_page: { Args: { p_org_slug: string }; Returns: Json }
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
      get_survey_bundle: { Args: { p_slug: string }; Returns: Json }
      get_volunteer_opportunity_detail: {
        Args: { p_opportunity_id: string }
        Returns: Json
      }
      get_volunteer_shift_ics: { Args: { p_shift_id: string }; Returns: string }
      giving_handoff_no_show_sweep: { Args: never; Returns: number }
      has_admin_role:
        | { Args: { role_name: string; uid: string }; Returns: boolean }
        | {
            Args: { role_name: string; scope: string; uid: string }
            Returns: boolean
          }
      has_blocked: {
        Args: { blocked: string; blocker: string }
        Returns: boolean
      }
      has_world_permission: {
        Args: { p_action?: string; p_user: string; p_world_slug: string }
        Returns: boolean
      }
      haversine_km: {
        Args: { lat1: number; lat2: number; lon1: number; lon2: number }
        Returns: number
      }
      inject_system_message: {
        Args: { p_body?: string; p_chat_id: string; p_payload: Json }
        Returns: string
      }
      is_active_member: { Args: { uid: string }; Returns: boolean }
      is_admin: { Args: { uid: string }; Returns: boolean }
      is_ancestor: {
        Args: { p_ancestor: string; p_node: string }
        Returns: boolean
      }
      is_blocked: { Args: { a: string; b: string }; Returns: boolean }
      is_chat_participant: {
        Args: { p_chat_id: string; p_user: string }
        Returns: boolean
      }
      is_chat_visible_to: {
        Args: {
          p_chat: Database["public"]["Tables"]["chats"]["Row"]
          p_viewer: string
        }
        Returns: boolean
      }
      is_following: {
        Args: { followed: string; follower: string }
        Returns: boolean
      }
      is_listing_operator: { Args: { p_viewer: string }; Returns: boolean }
      is_listing_visible_to: {
        Args: {
          p_listing: Database["public"]["Tables"]["listings"]["Row"]
          p_viewer: string
        }
        Returns: boolean
      }
      is_post_engagement_visible: {
        Args: { p_post_id: string; p_viewer: string }
        Returns: boolean
      }
      is_post_visible_to: {
        Args: {
          p_post: Database["public"]["Tables"]["posts"]["Row"]
          p_viewer: string
        }
        Returns: boolean
      }
      is_pro: { Args: { p_user_id: string }; Returns: boolean }
      karma_apply: {
        Args: {
          p_delta: number
          p_event: string
          p_ref_id: string
          p_ref_type: string
          p_user: string
        }
        Returns: undefined
      }
      karma_award_handoff: {
        Args: {
          p_giver: string
          p_handoff_id: string
          p_receiver: string
          p_world: string
        }
        Returns: undefined
      }
      karma_grant_once: {
        Args: {
          p_delta: number
          p_event: string
          p_ref_id: string
          p_ref_type: string
          p_user: string
        }
        Returns: undefined
      }
      karma_handoff_points: {
        Args: { p_role: string; p_world: string }
        Returns: number
      }
      karma_recompute_nightly: {
        Args: never
        Returns: {
          drift_events: number
          users_processed: number
        }[]
      }
      karma_value_bonus: { Args: { p_value: number }; Returns: number }
      kc_dev_cleanup_e2e_listings: {
        Args: { p_min_age?: string }
        Returns: Json
      }
      kc_dev_is_e2e_title: { Args: { p_title: string }; Returns: boolean }
      kc_dev_is_seeded: { Args: never; Returns: boolean }
      list_active_surveys: { Args: never; Returns: Json }
      list_my_donation_history: {
        Args: { p_limit?: number }
        Returns: {
          amount_ils: number
          org_id: string
          org_name: string
          paid_at: string
          payment_id: string
          receipt_id: string
          section46_serial: string
        }[]
      }
      list_my_giving_handoffs: {
        Args: { p_limit?: number }
        Returns: {
          handoff_id: string
          listing_id: string
          pickup_window_end: string
          pickup_window_start: string
          reserved_at: string
          role: string
          status: string
          title: string
          world_slug: string
        }[]
      }
      list_my_listings: {
        Args: {
          p_cursor_id?: string
          p_cursor_updated_at?: string
          p_limit?: number
          p_offset?: number
        }
        Returns: {
          availability_status: string
          direction: string
          kind_slug: string
          listing_id: string
          status: string
          summary: string
          title: string
          updated_at: string
          urgency_level: number
          world_slug: string
        }[]
      }
      list_my_standing_orders: {
        Args: { p_limit?: number }
        Returns: {
          amount_ils: number
          cadence: string
          cancelled_at: string | null
          created_at: string
          idempotency_key: string
          next_charge_at: string | null
          order_id: string
          org_id: string
          provider_id: string | null
          provider_ref: string | null
          status: string
          user_id: string
        }[]
        SetofOptions: {
          from: "*"
          to: "standing_orders"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      list_my_volunteer_opportunities: {
        Args: { p_limit?: number }
        Returns: {
          city_id: string | null
          created_at: string
          location_label: string | null
          opportunity_id: string
          org_id: string | null
          organizer_id: string
          status: string
          summary: string | null
          title: string
          updated_at: string
        }[]
        SetofOptions: {
          from: "*"
          to: "volunteer_opportunities"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      list_my_volunteer_signups: {
        Args: { p_limit?: number }
        Returns: {
          ends_at: string
          hours_logged: number
          opportunity_id: string
          shift_id: string
          signup_id: string
          starts_at: string
          status: string
          title: string
        }[]
      }
      list_profile_listings: {
        Args: { p_limit?: number; p_owner_id: string }
        Returns: {
          direction: string
          kind_slug: string
          listing_id: string
          status: string
          summary: string
          title: string
          world_slug: string
        }[]
      }
      list_ride_bookings: {
        Args: { p_listing_id: string }
        Returns: {
          avatar_url: string
          confirm_by: string
          handoff_id: string
          passenger_name: string
          rated_by_me: boolean
          recipient_id: string
          reserved_at: string
          seats: number
          status: string
        }[]
      }
      list_ride_places: {
        Args: never
        Returns: {
          city_id: string
          label: string
          lat: number
          lng: number
          place_id: string
          place_kind: string
        }[]
      }
      list_rides_feed: {
        Args: { p_limit?: number }
        Returns: {
          departs_at: string
          dest_label: string
          direction: string
          listing_id: string
          meeting_points: number
          origin_label: string
          passengers: number
          seats_left: number
          title: string
        }[]
      }
      list_shift_volunteers: {
        Args: { p_shift_id: string }
        Returns: {
          display_name: string
          hours_logged: number
          share_handle: string
          signup_id: string
          status: string
          user_id: string
          waitlist_position: number
        }[]
      }
      list_verified_nonprofits: {
        Args: { p_limit?: number }
        Returns: {
          is_verified_nonprofit: boolean
          name: string
          org_id: string
          slug: string
          tagline_en: string
          tagline_he: string
        }[]
      }
      list_volunteer_opportunities: {
        Args: { p_limit?: number; p_offset?: number }
        Returns: {
          city_id: string
          location_label: string
          next_shift_at: string
          open_slots: number
          opportunity_id: string
          summary: string
          title: string
        }[]
      }
      listing_details_expires_at: { Args: { p_details: Json }; Returns: string }
      listing_feed_mirror_status: {
        Args: { p_listing: Database["public"]["Tables"]["listings"]["Row"] }
        Returns: string
      }
      listing_feed_mirror_sync_media: {
        Args: { p_listing_id: string; p_post_id: string }
        Returns: undefined
      }
      listing_feed_mirror_upsert: {
        Args: { p_listing: Database["public"]["Tables"]["listings"]["Row"] }
        Returns: string
      }
      listing_geo_from_city: { Args: { p_city_id: string }; Returns: unknown }
      listing_upsert_from_post: {
        Args: { p_post: Database["public"]["Tables"]["posts"]["Row"] }
        Returns: undefined
      }
      listing_upsert_from_ride: {
        Args: { p_ride: Database["public"]["Tables"]["ride_listings"]["Row"] }
        Returns: undefined
      }
      map_listing_clusters: {
        Args: {
          p_ne_lat: number
          p_ne_lng: number
          p_sw_lat: number
          p_sw_lng: number
          p_viewer?: string
          p_world_slug?: string
        }
        Returns: {
          center_lat: number
          center_lng: number
          cluster_key: string
          listing_count: number
          sample_listing_id: string
        }[]
      }
      map_listing_pins: {
        Args: {
          p_limit?: number
          p_ne_lat: number
          p_ne_lng: number
          p_sw_lat: number
          p_sw_lng: number
          p_world_slug?: string
        }
        Returns: {
          departs_at: string
          dest_label: string
          dest_lat: number
          dest_lng: number
          direction: string
          kind_slug: string
          lat: number
          listing_id: string
          lng: number
          origin_label: string
          origin_lat: number
          origin_lng: number
          seats: number
          summary: string
          title: string
          world_slug: string
        }[]
      }
      mark_giving_handed_over: {
        Args: { p_handoff_id: string }
        Returns: {
          cancel_reason: string | null
          cancelled_at: string | null
          confirm_by: string | null
          confirmed_at: string | null
          handed_over_at: string | null
          handoff_id: string
          listing_id: string
          no_show_at: string | null
          owner_id: string
          pickup_mode: string
          pickup_window_end: string | null
          pickup_window_start: string | null
          recipient_id: string
          reserved_at: string
          seats: number
          slot_ends_at: string | null
          slot_starts_at: string | null
          status: string
          world_slug: string
        }
        SetofOptions: {
          from: "*"
          to: "giving_handoffs"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      marketplace_search: {
        Args: {
          p_cursor_id?: string
          p_cursor_score?: number
          p_limit?: number
          p_query?: string
          p_viewer?: string
          p_world_slug?: string
        }
        Returns: {
          fts_rank: number
          geo_rank: number
          listing_id: string
          rrf_score: number
          trgm_rank: number
          vector_rank: number
        }[]
      }
      match_compute_for_listing: {
        Args: { p_listing_id: string }
        Returns: number
      }
      match_deliver_pending: {
        Args: { p_limit?: number; p_listing_id?: string }
        Returns: Json
      }
      match_effective_score: {
        Args: { p_llm: number; p_score: number }
        Returns: number
      }
      match_in_quiet_hours: {
        Args: { p_at?: string; p_user: string }
        Returns: boolean
      }
      match_listing_anchor: {
        Args: { p_listing: Database["public"]["Tables"]["listings"]["Row"] }
        Returns: unknown
      }
      match_listing_dest: {
        Args: { p_listing: Database["public"]["Tables"]["listings"]["Row"] }
        Returns: unknown
      }
      match_listing_window: {
        Args: { p_listing: Database["public"]["Tables"]["listings"]["Row"] }
        Returns: unknown
      }
      match_owners_declined: {
        Args: { p_a: string; p_b: string }
        Returns: boolean
      }
      match_run_sweep: { Args: { p_batch?: number }; Returns: Json }
      match_score_pair: {
        Args: {
          p_offer: Database["public"]["Tables"]["listings"]["Row"]
          p_request: Database["public"]["Tables"]["listings"]["Row"]
        }
        Returns: {
          components: Json
          distance_km: number
          eligible: boolean
          reason: string
          score: number
        }[]
      }
      match_text_heads: { Args: { p: string }; Returns: string[] }
      match_text_norm: { Args: { p: string }; Returns: string }
      match_text_score: {
        Args: {
          p_offer_summary: string
          p_offer_title: string
          p_request_summary: string
          p_request_title: string
        }
        Returns: Json
      }
      match_text_stopwords: { Args: never; Returns: string[] }
      match_text_tokens: { Args: { p: string }; Returns: string[] }
      match_token_in: {
        Args: { p_list: string[]; p_tok: string }
        Returns: boolean
      }
      match_token_stems: { Args: { p: string }; Returns: string[] }
      match_user_feedback: {
        Args: { p_user: string; p_world: string }
        Returns: number
      }
      match_user_mutes_listing: {
        Args: {
          p_listing: Database["public"]["Tables"]["listings"]["Row"]
          p_user: string
        }
        Returns: boolean
      }
      match_user_notified_today: { Args: { p_user: string }; Returns: number }
      match_user_trust: { Args: { p_user: string }; Returns: number }
      match_whatsapp_send: {
        Args: { p_payload: Json; p_template: string; p_user: string }
        Returns: string
      }
      merge_entities: {
        Args: { p_actor?: string; p_merged: string; p_survivor: string }
        Returns: string
      }
      needs_legal_reacknowledgement: {
        Args: never
        Returns: {
          block_mode: string
          current_effective_date: string
          current_version: number
          doc_type: Database["public"]["Enums"]["legal_doc_type"]
          last_accepted_version: number
          last_material_severity: string
          last_material_version: number
        }[]
      }
      notification_in_quiet_hours: {
        Args: { p_at?: string; p_prefs: Json }
        Returns: boolean
      }
      notification_inbox_group_meta: {
        Args: {
          p_row: Database["public"]["Tables"]["notifications_outbox"]["Row"]
        }
        Returns: {
          actor_id: string
          group_key: string
        }[]
      }
      notification_inbox_world_for_kind: {
        Args: { p_kind: string }
        Returns: string
      }
      notification_kind_enabled: {
        Args: { p_kind: string; p_prefs: Json }
        Returns: boolean
      }
      notifications_backlog_check: { Args: never; Returns: undefined }
      notifications_bump_attempt: {
        Args: { p_error: string; p_id: string }
        Returns: undefined
      }
      notifications_food_expiry_check: { Args: never; Returns: number }
      notifications_post_relevance_check: { Args: never; Returns: number }
      organizer_message_shift_volunteers: {
        Args: { p_message: string; p_shift_id: string }
        Returns: number
      }
      participant_closed_surface_visible: {
        Args: {
          p_actor: string
          p_post: Database["public"]["Tables"]["posts"]["Row"]
          p_viewer: string
        }
        Returns: boolean
      }
      pause_my_listing: { Args: { p_listing_id: string }; Returns: undefined }
      pause_standing_order: {
        Args: { p_order_id: string }
        Returns: {
          amount_ils: number
          cadence: string
          cancelled_at: string | null
          created_at: string
          idempotency_key: string
          next_charge_at: string | null
          order_id: string
          org_id: string
          provider_id: string | null
          provider_ref: string | null
          status: string
          user_id: string
        }
        SetofOptions: {
          from: "*"
          to: "standing_orders"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      payment_ledger_post_balanced: {
        Args: { p_idempotency_key: string; p_lines: Json; p_txn_id: string }
        Returns: undefined
      }
      post_relevance_reminder_due: {
        Args: { p_age_days: number }
        Returns: boolean
      }
      post_stats_bump: {
        Args: {
          p_comment_delta?: number
          p_post_id: string
          p_reaction_delta?: number
          p_share_delta?: number
        }
        Returns: undefined
      }
      profile_closed_posts: {
        Args: {
          p_cursor?: string
          p_limit?: number
          p_list_mode?: string
          p_profile_user_id: string
          p_viewer_user_id: string
        }
        Returns: {
          closed_at: string
          identity_role: string
          post_id: string
        }[]
      }
      profile_closed_posts_count: {
        Args: {
          p_list_mode?: string
          p_profile_user_id: string
          p_viewer_user_id: string
        }
        Returns: number
      }
      provider_webhook_apply: {
        Args: { p_event_id: string; p_payload: Json; p_provider_slug: string }
        Returns: string
      }
      publish_legal_document: {
        Args: {
          p_body_md: string
          p_change_summary: string
          p_doc_type: Database["public"]["Enums"]["legal_doc_type"]
          p_effective_date: string
          p_severity: string
        }
        Returns: Json
      }
      publish_survey_version: {
        Args: {
          p_description_he: string
          p_is_active: boolean
          p_prompt_rules: Json
          p_questions: Json
          p_slug: string
          p_title_he: string
        }
        Returns: Json
      }
      publish_volunteer_opportunity: {
        Args: { p_opportunity_id: string }
        Returns: undefined
      }
      rate_giving_handoff: {
        Args: { p_comment?: string; p_handoff_id: string; p_rating: number }
        Returns: {
          comment: string | null
          created_at: string
          handoff_id: string
          ratee_id: string
          rater_id: string
          rating: number
          rating_id: string
        }
        SetofOptions: {
          from: "*"
          to: "giving_handoff_ratings"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      realtime_topic_uuid: { Args: { p_topic: string }; Returns: string }
      recommend_listings_for_user: {
        Args: { p_limit?: number; p_viewer?: string }
        Returns: {
          listing_id: string
          reason: string
          score: number
        }[]
      }
      record_listing_signal: {
        Args: { p_listing_id: string; p_signal_type: string; p_weight?: number }
        Returns: undefined
      }
      refresh_feed_open_posts_mv: {
        Args: { p_concurrent?: boolean }
        Returns: number
      }
      reopen_post_deleted_no_recipient: {
        Args: { p_post_id: string }
        Returns: {
          category: string
          city: string
          created_at: string
          delete_after: string | null
          description: string | null
          estimated_value: number | null
          item_condition: string | null
          listing_id: string | null
          listing_world_slug: string | null
          location_display_level: string
          owner_id: string
          post_id: string
          reopen_count: number
          search_vector: unknown
          source_language: string | null
          source_language_confidence: number | null
          status: string
          status_before_admin_removal: string | null
          street: string
          street_number: string
          title: string
          type: string
          updated_at: string
          urgency: string | null
          visibility: string
        }
        SetofOptions: {
          from: "*"
          to: "posts"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      reopen_post_marked: {
        Args: { p_post_id: string }
        Returns: {
          category: string
          city: string
          created_at: string
          delete_after: string | null
          description: string | null
          estimated_value: number | null
          item_condition: string | null
          listing_id: string | null
          listing_world_slug: string | null
          location_display_level: string
          owner_id: string
          post_id: string
          reopen_count: number
          search_vector: unknown
          source_language: string | null
          source_language_confidence: number | null
          status: string
          status_before_admin_removal: string | null
          street: string
          street_number: string
          title: string
          type: string
          updated_at: string
          urgency: string | null
          visibility: string
        }
        SetofOptions: {
          from: "*"
          to: "posts"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      report_donation_link: { Args: { p_link_id: string }; Returns: undefined }
      reports_case_detail: {
        Args: { p_target_id: string; p_target_type: string }
        Returns: Json
      }
      reports_open_inbox: {
        Args: {
          p_cursor?: Json
          p_limit?: number
          p_max_age_days?: number
          p_reporter_filter?: string
          p_target_type_filter?: string
        }
        Returns: Json
      }
      reserve_item_giving: {
        Args: {
          p_listing_id: string
          p_pickup_mode?: string
          p_pickup_window_end?: string
          p_pickup_window_start?: string
        }
        Returns: {
          cancel_reason: string | null
          cancelled_at: string | null
          confirm_by: string | null
          confirmed_at: string | null
          handed_over_at: string | null
          handoff_id: string
          listing_id: string
          no_show_at: string | null
          owner_id: string
          pickup_mode: string
          pickup_window_end: string | null
          pickup_window_start: string | null
          recipient_id: string
          reserved_at: string
          seats: number
          slot_ends_at: string | null
          slot_starts_at: string | null
          status: string
          world_slug: string
        }
        SetofOptions: {
          from: "*"
          to: "giving_handoffs"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      resolve_comment_mentions: { Args: { p_body: string }; Returns: string[] }
      resolve_match_weights: {
        Args: { p_user: string; p_world: string }
        Returns: {
          w_fts: number
          w_geo: number
          w_trust: number
          w_vector: number
        }[]
      }
      resume_my_listing: { Args: { p_listing_id: string }; Returns: undefined }
      resume_standing_order: {
        Args: { p_order_id: string }
        Returns: {
          amount_ils: number
          cadence: string
          cancelled_at: string | null
          created_at: string
          idempotency_key: string
          next_charge_at: string | null
          order_id: string
          org_id: string
          provider_id: string | null
          provider_ref: string | null
          status: string
          user_id: string
        }
        SetofOptions: {
          from: "*"
          to: "standing_orders"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      ride_booking_copy_key: { Args: { p_kind: string }; Returns: string }
      ride_bookings_expire_sweep: { Args: never; Returns: number }
      ride_complete_pending_rating_cleanup: { Args: never; Returns: undefined }
      ride_cost_share_cap: { Args: { p_details: Json }; Returns: number }
      ride_details_with_place: {
        Args: { p_details: Json; p_end: string }
        Returns: Json
      }
      ride_food_overdue_alert: { Args: never; Returns: undefined }
      ride_listing_emergency: {
        Args: { p_listing_id: string; p_note?: string }
        Returns: {
          event_id: string
          listing_id: string
          note: string | null
          resolved_at: string | null
          resolved_by: string | null
          triggered_at: string
          triggered_by: string
        }
        SetofOptions: {
          from: "*"
          to: "ride_listing_emergencies"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      ride_listing_participants: {
        Args: { p_listing_id: string }
        Returns: string[]
      }
      ride_listings_expire_check: { Args: never; Returns: number }
      ride_listings_find_matches: {
        Args: { p_limit?: number; p_ride_id: string; p_window_hours?: number }
        Returns: {
          arrive_reason: string | null
          arrived_at: string | null
          cargo_allowed_types: string[] | null
          cargo_enabled: boolean
          cargo_max_volume_l: number | null
          cargo_max_weight_kg: number | null
          created_at: string
          departs_at: string
          description: string | null
          dest_city_id: string
          dest_street: string
          dest_street_number: string | null
          food_chilled: boolean | null
          food_handover_to_org: boolean
          food_max_kg: number | null
          food_shipping_enabled: boolean
          linked_post_id: string | null
          mode: string
          origin_city_id: string
          origin_street: string
          origin_street_number: string | null
          owner_id: string
          payment_amount_ils: number | null
          payment_model: string
          req_gender: string
          req_pets_allowed: boolean
          req_smoking_allowed: boolean
          req_verified_only: boolean
          ride_id: string
          seats_available: number | null
          started_at: string | null
          status: string
          template_id: string | null
          title: string
          updated_at: string
          visibility: string
        }[]
        SetofOptions: {
          from: "*"
          to: "ride_listings"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      ride_listings_search: {
        Args: {
          p_cursor?: string
          p_depart_from?: string
          p_depart_to?: string
          p_dest_city_id?: string
          p_limit?: number
          p_mode?: string
          p_origin_city_id?: string
          p_query?: string
        }
        Returns: {
          arrive_reason: string | null
          arrived_at: string | null
          cargo_allowed_types: string[] | null
          cargo_enabled: boolean
          cargo_max_volume_l: number | null
          cargo_max_weight_kg: number | null
          created_at: string
          departs_at: string
          description: string | null
          dest_city_id: string
          dest_street: string
          dest_street_number: string | null
          food_chilled: boolean | null
          food_handover_to_org: boolean
          food_max_kg: number | null
          food_shipping_enabled: boolean
          linked_post_id: string | null
          mode: string
          origin_city_id: string
          origin_street: string
          origin_street_number: string | null
          owner_id: string
          payment_amount_ils: number | null
          payment_model: string
          req_gender: string
          req_pets_allowed: boolean
          req_smoking_allowed: boolean
          req_verified_only: boolean
          ride_id: string
          seats_available: number | null
          started_at: string | null
          status: string
          template_id: string | null
          title: string
          updated_at: string
          visibility: string
        }[]
        SetofOptions: {
          from: "*"
          to: "ride_listings"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      ride_matching_routes: {
        Args: { p_listing: Database["public"]["Tables"]["listings"]["Row"] }
        Returns: {
          created_at: string
          dest_label: string
          dest_lat: number
          dest_lng: number
          dest_place_id: string
          dest_place_kind: string
          origin_label: string
          origin_lat: number
          origin_lng: number
          origin_place_id: string
          origin_place_kind: string
          radius_km: number
          route_id: string
          time_from: string | null
          time_to: string | null
          user_id: string
          wants: string
          weekdays: number | null
        }[]
        SetofOptions: {
          from: "listings"
          to: "ride_saved_routes"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      ride_participants_expire_stale_check: { Args: never; Returns: number }
      ride_place_lookup: {
        Args: { p_id: string; p_kind: string }
        Returns: {
          city_id: string
          label: string
          lat: number
          lng: number
        }[]
      }
      ride_point_within: {
        Args: {
          p_km: number
          p_lat: number
          p_lat2: number
          p_lng: number
          p_lng2: number
        }
        Returns: boolean
      }
      ride_quiet_window_end: {
        Args: { p_at?: string; p_user: string }
        Returns: string
      }
      ride_route_alert_deliver: {
        Args: { p_listing_id: string; p_route_id: string }
        Returns: string
      }
      ride_route_alerts_sweep: { Args: never; Returns: number }
      ride_templates_materialize: { Args: never; Returns: number }
      rides_expired_listings_sweep: { Args: never; Returns: number }
      role_rank: { Args: { p_role: string }; Returns: number }
      rpc_chat_hide_for_viewer: {
        Args: { p_chat_id: string }
        Returns: undefined
      }
      rpc_chat_mark_read: { Args: { p_chat_id: string }; Returns: undefined }
      rpc_chat_set_anchor: {
        Args: { p_anchor_post_id: string; p_chat_id: string }
        Returns: {
          anchor_listing_id: string | null
          anchor_post_id: string | null
          anchor_ride_id: string | null
          chat_id: string
          created_at: string
          inbox_hidden_at_a: string | null
          inbox_hidden_at_b: string | null
          is_support_thread: boolean
          last_message_at: string
          participant_a: string | null
          participant_b: string | null
          removed_at: string | null
        }
        SetofOptions: {
          from: "*"
          to: "chats"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      rpc_chat_set_anchor_ride: {
        Args: { p_anchor_ride_id: string; p_chat_id: string }
        Returns: {
          anchor_listing_id: string | null
          anchor_post_id: string | null
          anchor_ride_id: string | null
          chat_id: string
          created_at: string
          inbox_hidden_at_a: string | null
          inbox_hidden_at_b: string | null
          is_support_thread: boolean
          last_message_at: string
          participant_a: string | null
          participant_b: string | null
          removed_at: string | null
        }
        SetofOptions: {
          from: "*"
          to: "chats"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      rpc_chat_unread_total: { Args: never; Returns: number }
      rpc_create_post_comment: {
        Args: {
          p_body: string
          p_parent_comment_id?: string
          p_post_id: string
        }
        Returns: {
          author_id: string
          body: string
          comment_id: string
          created_at: string
          edited_at: string | null
          mention_user_ids: string[]
          parent_comment_id: string | null
          post_id: string
          status: string
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "post_comments"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      rpc_delete_post_comment: {
        Args: { p_comment_id: string }
        Returns: {
          author_id: string
          body: string
          comment_id: string
          created_at: string
          edited_at: string | null
          mention_user_ids: string[]
          parent_comment_id: string | null
          post_id: string
          status: string
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "post_comments"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      rpc_feed_add_mute_filter: {
        Args: { p_filter_kind: string; p_filter_value: string }
        Returns: {
          created_at: string
          filter_id: string
          filter_kind: string
          filter_value: string
          user_id: string
        }
        SetofOptions: {
          from: "*"
          to: "feed_mute_filters"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      rpc_feed_hide_post: { Args: { p_post_id: string }; Returns: undefined }
      rpc_feed_list_mute_filters: {
        Args: never
        Returns: {
          created_at: string
          filter_id: string
          filter_kind: string
          filter_value: string
          user_id: string
        }[]
        SetofOptions: {
          from: "*"
          to: "feed_mute_filters"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      rpc_feed_log_impressions: {
        Args: { p_post_ids: string[] }
        Returns: number
      }
      rpc_feed_remove_mute_filter: {
        Args: { p_filter_id: string }
        Returns: undefined
      }
      rpc_follow_suggestions: {
        Args: { p_limit?: number }
        Returns: {
          avatar_url: string
          city_name: string
          display_name: string
          followers_count: number
          reason: string
          score: number
          share_handle: string
          user_id: string
        }[]
      }
      rpc_get_or_create_support_thread: {
        Args: never
        Returns: {
          anchor_listing_id: string | null
          anchor_post_id: string | null
          anchor_ride_id: string | null
          chat_id: string
          created_at: string
          inbox_hidden_at_a: string | null
          inbox_hidden_at_b: string | null
          is_support_thread: boolean
          last_message_at: string
          participant_a: string | null
          participant_b: string | null
          removed_at: string | null
        }
        SetofOptions: {
          from: "*"
          to: "chats"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      rpc_get_post_engagement_stats: {
        Args: { p_post_id: string }
        Returns: {
          comment_count: number
          post_id: string
          reaction_count: number
          share_count: number
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "post_stats"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      rpc_get_show_active_status: { Args: never; Returns: boolean }
      rpc_log_post_share: {
        Args: {
          p_external_channel?: string
          p_post_id: string
          p_repost_post_id?: string
          p_share_kind: string
        }
        Returns: {
          created_at: string
          external_channel: string | null
          post_id: string
          repost_post_id: string | null
          share_id: string
          share_kind: string
          user_id: string
        }
        SetofOptions: {
          from: "*"
          to: "post_shares"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      rpc_match_refresh_mine: { Args: never; Returns: number }
      rpc_match_respond: {
        Args: { p_candidate_id: string; p_response: string }
        Returns: Json
      }
      rpc_my_activity_timeline: {
        Args: { p_limit?: number }
        Returns: {
          actor_display_name: string
          kind: string
          occurred_at: string
          post_id: string
          post_title: string
        }[]
      }
      rpc_my_matches: {
        Args: { p_limit?: number }
        Returns: {
          candidate_id: string
          components: Json
          created_at: string
          distance_km: number
          llm_reason: string
          my_listing_id: string
          my_listing_title: string
          my_response: string
          my_role: string
          other_listing_id: string
          other_listing_summary: string
          other_listing_title: string
          other_owner_avatar: string
          other_owner_handle: string
          other_owner_id: string
          other_owner_name: string
          other_response: string
          score: number
          status: string
          world_slug: string
        }[]
      }
      rpc_notification_inbox_list: {
        Args: {
          p_category?: string
          p_cursor_created_at?: string
          p_cursor_inbox_id?: string
          p_limit?: number
          p_world?: string
        }
        Returns: {
          body_args: Json
          body_key: string
          category: string
          created_at: string
          data: Json
          group_actor_ids: string[]
          group_count: number
          group_key: string | null
          inbox_id: string
          kind: string
          outbox_id: string | null
          read_at: string | null
          title_key: string
          updated_at: string
          user_id: string
          world: string
        }[]
        SetofOptions: {
          from: "*"
          to: "notification_inbox"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      rpc_notification_inbox_mark_all_read: { Args: never; Returns: number }
      rpc_notification_inbox_mark_read: {
        Args: { p_inbox_id: string }
        Returns: {
          body_args: Json
          body_key: string
          category: string
          created_at: string
          data: Json
          group_actor_ids: string[]
          group_count: number
          group_key: string | null
          inbox_id: string
          kind: string
          outbox_id: string | null
          read_at: string | null
          title_key: string
          updated_at: string
          user_id: string
          world: string
        }
        SetofOptions: {
          from: "*"
          to: "notification_inbox"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      rpc_notification_inbox_unread_count: { Args: never; Returns: number }
      rpc_profile_completeness: { Args: { p_user_id?: string }; Returns: Json }
      rpc_recipient_unmark_self: {
        Args: { p_post_id: string }
        Returns: undefined
      }
      rpc_record_active_day: { Args: never; Returns: undefined }
      rpc_republish_post: { Args: { p_post_id: string }; Returns: string }
      rpc_ride_arrive: {
        Args: { p_reason?: string; p_ride_id: string }
        Returns: {
          arrive_reason: string | null
          arrived_at: string | null
          cargo_allowed_types: string[] | null
          cargo_enabled: boolean
          cargo_max_volume_l: number | null
          cargo_max_weight_kg: number | null
          created_at: string
          departs_at: string
          description: string | null
          dest_city_id: string
          dest_street: string
          dest_street_number: string | null
          food_chilled: boolean | null
          food_handover_to_org: boolean
          food_max_kg: number | null
          food_shipping_enabled: boolean
          linked_post_id: string | null
          mode: string
          origin_city_id: string
          origin_street: string
          origin_street_number: string | null
          owner_id: string
          payment_amount_ils: number | null
          payment_model: string
          req_gender: string
          req_pets_allowed: boolean
          req_smoking_allowed: boolean
          req_verified_only: boolean
          ride_id: string
          seats_available: number | null
          started_at: string | null
          status: string
          template_id: string | null
          title: string
          updated_at: string
          visibility: string
        }
        SetofOptions: {
          from: "*"
          to: "ride_listings"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      rpc_ride_emergency_trigger: {
        Args: {
          p_lat?: number
          p_lng?: number
          p_note?: string
          p_ride_id: string
        }
        Returns: {
          event_id: string
          lat: number | null
          lng: number | null
          note: string | null
          resolved_at: string | null
          resolved_by: string | null
          ride_id: string
          triggered_at: string
          triggered_by: string
        }
        SetofOptions: {
          from: "*"
          to: "ride_emergency_events"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      rpc_ride_participants_cancel: {
        Args: { p_participant_id: string }
        Returns: {
          decided_at: string | null
          decided_by: string | null
          joined_active_at: string | null
          note: string | null
          participant_id: string
          requested_at: string
          ride_id: string
          status: string
          user_id: string
        }
        SetofOptions: {
          from: "*"
          to: "ride_participants"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      rpc_ride_participants_decide: {
        Args: { p_participant_id: string; p_status: string }
        Returns: {
          decided_at: string | null
          decided_by: string | null
          joined_active_at: string | null
          note: string | null
          participant_id: string
          requested_at: string
          ride_id: string
          status: string
          user_id: string
        }
        SetofOptions: {
          from: "*"
          to: "ride_participants"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      rpc_ride_participants_request: {
        Args: { p_note?: string; p_ride_id: string }
        Returns: {
          decided_at: string | null
          decided_by: string | null
          joined_active_at: string | null
          note: string | null
          participant_id: string
          requested_at: string
          ride_id: string
          status: string
          user_id: string
        }
        SetofOptions: {
          from: "*"
          to: "ride_participants"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      rpc_ride_rate: {
        Args: {
          p_comment?: string
          p_is_penalty?: boolean
          p_ratee_id: string
          p_ride_id: string
          p_stars: number
        }
        Returns: {
          comment: string | null
          created_at: string
          is_penalty: boolean
          ratee_id: string
          rater_id: string
          rating_id: string
          ride_id: string
          stars: number
        }
        SetofOptions: {
          from: "*"
          to: "ride_ratings"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      rpc_ride_start: {
        Args: { p_ride_id: string }
        Returns: {
          arrive_reason: string | null
          arrived_at: string | null
          cargo_allowed_types: string[] | null
          cargo_enabled: boolean
          cargo_max_volume_l: number | null
          cargo_max_weight_kg: number | null
          created_at: string
          departs_at: string
          description: string | null
          dest_city_id: string
          dest_street: string
          dest_street_number: string | null
          food_chilled: boolean | null
          food_handover_to_org: boolean
          food_max_kg: number | null
          food_shipping_enabled: boolean
          linked_post_id: string | null
          mode: string
          origin_city_id: string
          origin_street: string
          origin_street_number: string | null
          owner_id: string
          payment_amount_ils: number | null
          payment_model: string
          req_gender: string
          req_pets_allowed: boolean
          req_smoking_allowed: boolean
          req_verified_only: boolean
          ride_id: string
          seats_available: number | null
          started_at: string | null
          status: string
          template_id: string | null
          title: string
          updated_at: string
          visibility: string
        }
        SetofOptions: {
          from: "*"
          to: "ride_listings"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      rpc_ride_update_visibility: {
        Args: { p_ride_id: string; p_visibility: string }
        Returns: {
          arrive_reason: string | null
          arrived_at: string | null
          cargo_allowed_types: string[] | null
          cargo_enabled: boolean
          cargo_max_volume_l: number | null
          cargo_max_weight_kg: number | null
          created_at: string
          departs_at: string
          description: string | null
          dest_city_id: string
          dest_street: string
          dest_street_number: string | null
          food_chilled: boolean | null
          food_handover_to_org: boolean
          food_max_kg: number | null
          food_shipping_enabled: boolean
          linked_post_id: string | null
          mode: string
          origin_city_id: string
          origin_street: string
          origin_street_number: string | null
          owner_id: string
          payment_amount_ils: number | null
          payment_model: string
          req_gender: string
          req_pets_allowed: boolean
          req_smoking_allowed: boolean
          req_verified_only: boolean
          ride_id: string
          seats_available: number | null
          started_at: string | null
          status: string
          template_id: string | null
          title: string
          updated_at: string
          visibility: string
        }
        SetofOptions: {
          from: "*"
          to: "ride_listings"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      rpc_search_suggested_queries: { Args: never; Returns: string[] }
      rpc_send_chat_media_message: {
        Args: { p_body?: string; p_chat_id: string; p_media_payload: Json }
        Returns: {
          body: string | null
          chat_id: string
          created_at: string
          delivered_at: string | null
          kind: string
          media_payload: Json | null
          message_id: string
          read_at: string | null
          sender_id: string | null
          source_language: string | null
          source_language_confidence: number | null
          status: string
          system_payload: Json | null
        }
        SetofOptions: {
          from: "*"
          to: "messages"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      rpc_set_message_reaction: {
        Args: { p_message_id: string; p_reaction_type: string }
        Returns: {
          created_at: string
          message_id: string
          reaction_id: string
          reaction_type: string
          user_id: string
        }
        SetofOptions: {
          from: "*"
          to: "message_reactions"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      rpc_set_post_reaction: {
        Args: { p_post_id: string; p_reaction_type: string }
        Returns: {
          created_at: string
          post_id: string
          reaction_id: string
          reaction_type: string
          user_id: string
        }
        SetofOptions: {
          from: "*"
          to: "post_reactions"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      rpc_set_show_active_status: {
        Args: { p_enabled: boolean }
        Returns: boolean
      }
      rpc_submit_support_issue: {
        Args: { p_category: string; p_description: string }
        Returns: {
          anchor_listing_id: string | null
          anchor_post_id: string | null
          anchor_ride_id: string | null
          chat_id: string
          created_at: string
          inbox_hidden_at_a: string | null
          inbox_hidden_at_b: string | null
          is_support_thread: boolean
          last_message_at: string
          participant_a: string | null
          participant_b: string | null
          removed_at: string | null
        }
        SetofOptions: {
          from: "*"
          to: "chats"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      rpc_sync_chat_messages: {
        Args: {
          p_after_created_at?: string
          p_after_message_id?: string
          p_chat_id: string
          p_limit?: number
        }
        Returns: {
          body: string | null
          chat_id: string
          created_at: string
          delivered_at: string | null
          kind: string
          media_payload: Json | null
          message_id: string
          read_at: string | null
          sender_id: string | null
          source_language: string | null
          source_language_confidence: number | null
          status: string
          system_payload: Json | null
        }[]
        SetofOptions: {
          from: "*"
          to: "messages"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      rpc_unread_counts_for_chats: {
        Args: { p_chat_ids: string[]; p_viewer_id: string }
        Returns: {
          chat_id: string
          unread_count: number
        }[]
      }
      rpc_update_post_comment: {
        Args: { p_body: string; p_comment_id: string }
        Returns: {
          author_id: string
          body: string
          comment_id: string
          created_at: string
          edited_at: string | null
          mention_user_ids: string[]
          parent_comment_id: string | null
          post_id: string
          status: string
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "post_comments"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      scale_retention_purge_notifications_outbox: {
        Args: { p_older_than?: string }
        Returns: number
      }
      search_all: {
        Args: { p_limit?: number; p_query: string; p_types?: string[] }
        Returns: Json
      }
      search_external_bodies: {
        Args: { p_limit?: number; p_query?: string; p_world_slug: string }
        Returns: {
          body_id: string
          body_type: string
          contact_url: string
          label_en: string
          label_he: string
          slug: string
          world_slug: string
        }[]
      }
      search_listings: {
        Args: {
          p_cursor_id?: string
          p_cursor_score?: number
          p_limit?: number
          p_query: string
          p_viewer?: string
          p_world_slug?: string
        }
        Returns: {
          fts_rank: number
          geo_rank: number
          listing_id: string
          rrf_score: number
          trgm_rank: number
          vector_rank: number
        }[]
      }
      search_posts_page: {
        Args: {
          p_category?: string
          p_city?: string
          p_limit?: number
          p_query: string
          p_type?: string
        }
        Returns: {
          created_at: string
          post_id: string
        }[]
      }
      search_users_page: {
        Args: {
          p_city?: string
          p_limit?: number
          p_min_followers?: number
          p_query: string
          p_sort?: string
        }
        Returns: {
          user_id: string
        }[]
      }
      seed_feed_performance_posts: {
        Args: { p_city_id: string; p_count?: number; p_owner_id: string }
        Returns: number
      }
      share_listing_to_feed: { Args: { p_listing_id: string }; Returns: string }
      shows_active_status: { Args: { p_user: string }; Returns: boolean }
      sign_up_volunteer_shift: {
        Args: { p_shift_id: string }
        Returns: {
          checked_in_at: string | null
          hours_logged: number | null
          shift_id: string
          signed_up_at: string
          signup_id: string
          status: string
          user_id: string
          waitlist_position: number | null
        }
        SetofOptions: {
          from: "*"
          to: "volunteer_shift_signups"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      similar_listings: {
        Args: { p_limit?: number; p_listing_id: string }
        Returns: {
          kind_slug: string
          listing_id: string
          title: string
          world_slug: string
        }[]
      }
      social_rpc_capture_explain: {
        Args: {
          p_elapsed_ms?: number
          p_notes?: string
          p_plan_text: string
          p_rpc_name: string
        }
        Returns: string
      }
      start_listing_chat: {
        Args: { p_listing_id: string; p_opening_message?: string }
        Returns: string
      }
      stats_recompute_personal_counters_nightly: {
        Args: never
        Returns: {
          drift_events: number
          users_processed: number
        }[]
      }
      stats_safe_dec: { Args: { p_value: number }; Returns: number }
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
      suspension_expiry_lift: { Args: never; Returns: number }
      timesheet_approve: {
        Args: { p_entry_id: string; p_note?: string }
        Returns: undefined
      }
      timesheet_decide: {
        Args: { p_approve: boolean; p_entry_id: string; p_note?: string }
        Returns: undefined
      }
      timesheet_delete: { Args: { p_entry_id: string }; Returns: undefined }
      timesheet_list: {
        Args: {
          p_from?: string
          p_limit?: number
          p_offset?: number
          p_status?: string
          p_to?: string
          p_user_id?: string
        }
        Returns: {
          approval_note: string
          approved_at: string
          approved_by: string
          approver_name: string
          created_at: string
          description: string
          entry_id: string
          hours_x100: number
          project: string
          status: string
          submitted_at: string
          total_count: number
          updated_at: string
          user_id: string
          user_name: string
          work_date: string
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
      undo_merge: {
        Args: { p_actor?: string; p_merge_id: string }
        Returns: undefined
      }
      update_my_listing: {
        Args: {
          p_availability_status?: string
          p_city_id?: string
          p_details?: Json
          p_listing_id: string
          p_max_radius_km?: number
          p_summary?: string
          p_title?: string
          p_urgency_level?: number
        }
        Returns: undefined
      }
      upsert_post_actor_identity: {
        Args: {
          p_hide_from_counterparty: boolean
          p_post_id: string
          p_surface_visibility: string
        }
        Returns: undefined
      }
      upsert_survey_answers: {
        Args: { p_answers: Json; p_slug: string }
        Returns: undefined
      }
      user_active_days_14d: {
        Args: { p_day: string; p_user_id: string }
        Returns: number
      }
      users_get_self_private_fields: { Args: never; Returns: Json }
      users_merge_notification_preferences: {
        Args: { p_merge: Json; p_user_id: string }
        Returns: Json
      }
      validate_listing_details: {
        Args: { p_details: Json; p_kind_id: string }
        Returns: boolean
      }
      visibility_to_anonymity_level: {
        Args: { p_visibility: string }
        Returns: number
      }
      volunteer_enqueue_signup_notifications: {
        Args: { p_signup_id: string }
        Returns: undefined
      }
      volunteer_shift_reminder_sweep: { Args: never; Returns: number }
      whatsapp_link_code_hash: { Args: { p_code: string }; Returns: string }
      whatsapp_mask_wa_id: { Args: { p_wa_id: string }; Returns: string }
      whatsapp_outbound_enqueue: {
        Args: { p_delay_seconds?: number; p_outbound_id: string }
        Returns: undefined
      }
      whatsapp_parse_keyword: { Args: { p_text: string }; Returns: Json }
      whatsapp_pgmq_enabled: { Args: never; Returns: boolean }
      whatsapp_rate_peek: {
        Args: { p_bucket: string; p_window_seconds: number }
        Returns: number
      }
      whatsapp_rate_take: {
        Args: { p_bucket: string; p_limit: number; p_window_seconds: number }
        Returns: boolean
      }
      whatsapp_rate_window: {
        Args: { p_window_seconds: number }
        Returns: string
      }
      whatsapp_user_can_receive: {
        Args: { p_user_id: string }
        Returns: boolean
      }
    }
    Enums: {
      legal_doc_type: "terms" | "privacy"
      survey_question_type:
        | "rating_1_7_with_optional_text"
        | "single_choice_with_optional_text"
    }
    CompositeTypes: {
      [_ in never]: never
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
    Enums: {
      legal_doc_type: ["terms", "privacy"],
      survey_question_type: [
        "rating_1_7_with_optional_text",
        "single_choice_with_optional_text",
      ],
    },
  },
} as const

